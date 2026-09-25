"""Copy every table of a Tally or Gam3a database into another database, ids and all.

Run it with the app's own Python from the app's folder, so it uses the app's tables:

    cd /opt/apps/gam3a/current
    .venv/bin/python /opt/apps/copy_db.py --src 'postgresql://…neon…' --dst sqlite:////var/lib/apps/gam3a/gam3a.db

The destination gets the app's newest tables first. It must be empty unless --replace is
given, which empties it before copying. Row counts are compared at the end; any difference
is an error, and nothing is committed.
"""

import argparse
import sys
from datetime import UTC, datetime

from sqlalchemy import func, inspect, select, text

sys.path.insert(0, ".")  # the app's folder

import app.models  # noqa: E402,F401  (registers every table)
from app import migrate  # noqa: E402
from app.database import Base, make_engine  # noqa: E402

BATCH = 1000


def fix_datetimes(row: dict, to_sqlite: bool) -> dict:
    """SQLite keeps UTC times without a zone; Postgres wants them with one."""
    for key, value in row.items():
        if isinstance(value, datetime):
            if to_sqlite and value.tzinfo is not None:
                row[key] = value.astimezone(UTC).replace(tzinfo=None)
            elif not to_sqlite and value.tzinfo is None:
                row[key] = value.replace(tzinfo=UTC)
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--src", required=True)
    parser.add_argument("--dst", required=True)
    parser.add_argument("--replace", action="store_true", help="empty the destination first")
    args = parser.parse_args()

    src, dst = make_engine(args.src), make_engine(args.dst)
    to_sqlite = dst.dialect.name == "sqlite"

    Base.metadata.create_all(dst)
    migrate.upgrade(dst)
    src_tables = set(inspect(src).get_table_names())
    tables = Base.metadata.sorted_tables  # parents before children

    with src.connect() as s, dst.begin() as d:
        users = Base.metadata.tables["users"]
        if d.scalar(select(func.count()).select_from(users)) and not args.replace:
            print("The destination already has accounts. Use --replace to overwrite it.", file=sys.stderr)
            return 2
        for table in reversed(tables):
            d.execute(table.delete())

        copied: dict[str, int] = {}
        for table in tables:
            if table.name not in src_tables:
                copied[table.name] = 0
                continue
            have = {c["name"] for c in inspect(src).get_columns(table.name)}
            columns = [c for c in table.columns if c.name in have]
            result = s.execution_options(yield_per=BATCH).execute(select(*columns))
            total = 0
            for part in result.mappings().partitions(BATCH):
                d.execute(table.insert(), [fix_datetimes(dict(r), to_sqlite) for r in part])
                total += len(part)
            copied[table.name] = total

        # Check before committing: every table must have exactly the rows it was sent.
        problems = []
        for table in tables:
            got = d.scalar(select(func.count()).select_from(table))
            if got != copied[table.name]:
                problems.append(f"{table.name}: copied {copied[table.name]}, found {got}")
        if problems:
            raise SystemExit("Row counts don't match, nothing was saved:\n  " + "\n  ".join(problems))

        # Postgres hands out new ids from a counter; move it past the copied ones.
        if dst.dialect.name == "postgresql":
            for table in tables:
                pk = list(table.primary_key.columns)
                if len(pk) == 1 and pk[0].name == "id" and pk[0].type.python_type is int:
                    d.execute(
                        text(
                            f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                            f"COALESCE((SELECT MAX(id) FROM {table.name}), 0) + 1, false)"
                        )
                    )

    for name, n in copied.items():
        print(f"  {name:<22} {n:>7} rows")
    print("Copy complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
