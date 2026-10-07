"""Tiny forward-only schema upgrades.

`create_all` creates missing tables but never adds columns to existing ones, so databases
created by an earlier version would miss new fields. Each entry here adds one column if
it isn't there yet. Safe to run on every start, on SQLite and Postgres.
"""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# table, column, SQL type + default
COLUMNS = [
    ("busy", "color", "VARCHAR(7) NOT NULL DEFAULT '#8A8F98'"),
    ("users", "cutoffs", "VARCHAR(400) NOT NULL DEFAULT ''"),
    ("users", "default_target", "VARCHAR(3) NOT NULL DEFAULT 'A'"),
    ("users", "class_minutes", "INTEGER NOT NULL DEFAULT 100"),
    ("users", "points", "VARCHAR(400) NOT NULL DEFAULT ''"),
    ("users", "bands", "VARCHAR(200) NOT NULL DEFAULT ''"),
    ("users", "timezone", "VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo'"),
    ("users", "lang", "VARCHAR(2) NOT NULL DEFAULT 'en'"),
    ("users", "timezone_auto", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("users", "google_sub", "VARCHAR(255)"),
    ("users", "notify_classes", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("users", "class_lead", "INTEGER NOT NULL DEFAULT 15"),
    ("users", "notify_deadlines", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("users", "deadline_lead", "INTEGER NOT NULL DEFAULT 1440"),
    ("users", "is_admin", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("users", "must_change_password", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("users", "session_version", "INTEGER NOT NULL DEFAULT 0"),
    ("courses", "target_grade", "VARCHAR(3)"),
    ("google_links", "class_reminder", "INTEGER NOT NULL DEFAULT 10"),
    ("google_links", "deadline_reminder", "INTEGER NOT NULL DEFAULT 1440"),
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
    if _optional_course(engine):
        added.append("assessments.course_id (optional)")
    return added


def _optional_course(engine: Engine) -> bool:
    """Let a deadline have no course (an everyday task). Postgres can simply drop NOT NULL;
    SQLite can't change a column, so the table is rebuilt with every row copied across, in one
    transaction (nothing else references this table). Returns True if it changed anything."""
    inspector = inspect(engine)
    if "assessments" not in inspector.get_table_names():
        return False
    columns = inspector.get_columns("assessments")
    course = next((c for c in columns if c["name"] == "course_id"), None)
    if course is None or course["nullable"]:
        return False
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE assessments ALTER COLUMN course_id DROP NOT NULL"))
        return True

    from .models import Assessment  # the current definition, with course_id optional

    table = Assessment.__table__
    old_names = {c["name"] for c in columns}
    shared = ", ".join(f'"{c.name}"' for c in table.columns if c.name in old_names)
    indexes = [i["name"] for i in inspector.get_indexes("assessments")]  # before the table is renamed
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE assessments RENAME TO assessments_old"))
        for name in indexes:  # they moved with the table; free their names for the new one
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
        table.create(conn)
        conn.execute(text(f"INSERT INTO assessments ({shared}) SELECT {shared} FROM assessments_old"))
        conn.execute(text("DROP TABLE assessments_old"))
    return True
