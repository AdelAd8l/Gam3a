"""The TA who gives a section or a lab."""

from .conftest import add_course

LAB = {"weekday": 2, "start": "10:00", "end": "11:40", "kind": "lab", "location": "Lab 3", "ta": "Eng. Sara Ali"}


def test_ta_is_saved_and_returned(client, term):
    course = add_course(client, term["id"], meetings=[LAB])
    assert course["meetings"][0]["ta"] == "Eng. Sara Ali"
    again = client.get(f"/api/courses/{course['id']}").json()
    assert again["meetings"][0]["ta"] == "Eng. Sara Ali"


def test_ta_is_optional(client, term):
    plain = {k: v for k, v in LAB.items() if k != "ta"}
    course = add_course(client, term["id"], meetings=[plain])
    assert course["meetings"][0]["ta"] == ""


def test_ta_name_has_a_length_limit(client, term):
    body = {"term_id": term["id"], "name": "Biology", "credits": 3, "meetings": [{**LAB, "ta": "x" * 81}]}
    assert client.post("/api/courses", json=body).status_code == 422


def test_ta_survives_editing_the_course(client, term):
    course = add_course(client, term["id"], meetings=[LAB])
    body = {"term_id": term["id"], "name": "Edited", "credits": 3, "meetings": [{**LAB, "ta": "Dr. Omar"}]}
    r = client.put(f"/api/courses/{course['id']}", json=body)
    assert r.status_code == 200 and r.json()["meetings"][0]["ta"] == "Dr. Omar"


def test_old_databases_get_the_column(tmp_path):
    from sqlalchemy import create_engine, inspect, text

    from app.migrate import upgrade

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE meetings (id INTEGER PRIMARY KEY, location VARCHAR(60))"))
        conn.execute(text("INSERT INTO meetings (location) VALUES ('Hall 1')"))
    assert "meetings.ta" in upgrade(engine)
    assert "ta" in {c["name"] for c in inspect(engine).get_columns("meetings")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT ta FROM meetings")).scalar() == ""


def test_lecture_doctor_is_saved_and_defaults_to_the_courses_main_one(client, term):
    from app.models import Course, Meeting, leader

    lecture = {**LAB, "kind": "lecture", "ta": "Dr. Hany"}
    course = add_course(client, term["id"], meetings=[lecture])
    assert course["meetings"][0]["ta"] == "Dr. Hany"

    c = Course(instructor="Prof. Main")
    assert leader(c, Meeting(kind="lecture", ta="")) == "Prof. Main"
    assert leader(c, Meeting(kind="lecture", ta="Dr. Hany")) == "Dr. Hany"
    assert leader(c, Meeting(kind="lab", ta="")) == ""  # a lab never borrows the doctor's name
