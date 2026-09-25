from sqlalchemy import create_engine, inspect, text

from app.migrate import upgrade


def test_adds_missing_columns_to_an_old_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255))"))
        conn.execute(text("CREATE TABLE assessments (id INTEGER PRIMARY KEY, title VARCHAR(100))"))
        conn.execute(text("INSERT INTO users (id, email) VALUES (1, 'a@b.co')"))
    added = upgrade(engine)
    assert "users.cutoffs" in added and "assessments.points_max" in added
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    assert {"cutoffs", "default_target"} <= cols
    with engine.connect() as conn:
        assert conn.execute(text("SELECT default_target FROM users")).scalar() == "A"
    assert upgrade(engine) == []  # idempotent
