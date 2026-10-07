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
    assert {"cutoffs", "default_target", "class_minutes", "points", "bands"} <= cols
    with engine.connect() as conn:
        assert conn.execute(text("SELECT default_target FROM users")).scalar() == "A"
    assert upgrade(engine) == []  # idempotent


def test_deadlines_can_lose_their_course_without_losing_rows(tmp_path):
    from datetime import date

    from sqlalchemy.orm import Session

    from app.database import Base
    from app.models import Course, Term, User

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # put back the old deadlines table, where every deadline needed a course
        conn.execute(text("DROP TABLE assessments"))
        conn.execute(text(
            "CREATE TABLE assessments (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),"
            " course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title VARCHAR(100) NOT NULL,"
            " kind VARCHAR(12) NOT NULL, due_date DATE, due_time VARCHAR(5), weight FLOAT, score FLOAT,"
            " done BOOLEAN NOT NULL)"
        ))
        conn.execute(text("CREATE INDEX ix_assessments_course_id ON assessments (course_id)"))
    with Session(engine) as db:  # a user with one term and one course, made the normal way
        db.add(User(id=1, email="a@b.co", name="A", password_hash=""))
        db.add(Term(id=1, user_id=1, name="T", start_date=date(2026, 9, 1), end_date=date(2026, 12, 31)))
        db.add(Course(id=1, user_id=1, term_id=1, name="C", credits=3))
        db.commit()
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO assessments (id, user_id, course_id, title, kind, due_date, weight, score, done)"
            " VALUES (7, 1, 1, 'Quiz 1', 'quiz', '2026-10-01', 10, 90, 1)"
        ))
    added = upgrade(engine)
    assert "assessments.course_id (optional)" in added
    course = next(c for c in inspect(engine).get_columns("assessments") if c["name"] == "course_id")
    assert course["nullable"]
    with engine.begin() as conn:
        assert conn.execute(text("SELECT id, course_id, title, weight, score, done FROM assessments")).one() == (
            7, 1, "Quiz 1", 10, 90, 1,
        )
        conn.execute(text("INSERT INTO assessments (user_id, course_id, title, kind, done) VALUES (1, NULL, 'Groceries', 'other', 0)"))
    assert "assessments_old" not in inspect(engine).get_table_names()
    assert {"ix_assessments_course_id", "ix_assessments_due_date"} <= {i["name"] for i in inspect(engine).get_indexes("assessments")}
    assert upgrade(engine) == []  # only once
