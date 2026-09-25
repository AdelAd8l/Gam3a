"""Tiny forward-only schema upgrades.

`create_all` creates missing tables but never adds columns to existing ones, so databases
created by an earlier version would miss new fields. Each entry here adds one column if
it isn't there yet. Safe to run on every start, on SQLite and Postgres.
"""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# table, column, SQL type + default
COLUMNS = [
    ("users", "cutoffs", "VARCHAR(400) NOT NULL DEFAULT ''"),
    ("users", "default_target", "VARCHAR(3) NOT NULL DEFAULT 'A'"),
    ("courses", "target_grade", "VARCHAR(3)"),
    ("assessments", "points_earned", "FLOAT"),
    ("assessments", "points_max", "FLOAT"),
]


def upgrade(engine: Engine) -> list[str]:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    added = []
    with engine.begin() as conn:
        for table, column, ddl in COLUMNS:
            if table not in tables:
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                added.append(f"{table}.{column}")
    return added
