"""The steps (subtasks) that make up a task."""

from .conftest import add_course, signup

STEPS = [
    {"title": "Intro", "done": True},
    {"title": "Topic 1", "done": False},
    {"title": "Topic 2", "done": False},
    {"title": "Conclusion", "done": False},
]


def task(**extra):
    return {"title": "Biology presentation", "kind": "project", "due_date": "2026-11-20", "subtasks": STEPS, **extra}


def test_a_task_keeps_its_steps_in_order(client, user):
    r = client.post("/api/assessments", json=task())
    assert r.status_code == 201, r.text
    assert [s["title"] for s in r.json()["subtasks"]] == ["Intro", "Topic 1", "Topic 2", "Conclusion"]
    assert r.json()["subtasks"][0]["done"] is True
    again = client.get(f"/api/assessments/{r.json()['id']}").json()
    assert again["subtasks"] == r.json()["subtasks"]


def test_steps_come_back_in_the_list_too(client, term):
    course = add_course(client, term["id"])
    client.post("/api/assessments", json=task(course_id=course["id"]))
    listed = client.get("/api/assessments", params={"term_id": term["id"]}).json()
    assert len(listed) == 1 and len(listed[0]["subtasks"]) == 4


def test_a_task_without_steps_has_an_empty_list(client, user):
    r = client.post("/api/assessments", json={"title": "Call the bank"})
    assert r.status_code == 201 and r.json()["subtasks"] == []


def test_editing_replaces_the_steps(client, user):
    made = client.post("/api/assessments", json=task()).json()
    body = {"title": made["title"], "kind": "project", "subtasks": [{"title": "Draft", "done": True}]}
    r = client.put(f"/api/assessments/{made['id']}", json=body)
    assert r.status_code == 200 and r.json()["subtasks"] == [{"title": "Draft", "done": True}]
    cleared = client.put(f"/api/assessments/{made['id']}", json={"title": "x", "subtasks": []}).json()
    assert cleared["subtasks"] == []


def test_step_titles_are_trimmed_and_cannot_be_blank(client, user):
    ok = client.post("/api/assessments", json={"title": "x", "subtasks": [{"title": "  Intro  "}]})
    assert ok.status_code == 201 and ok.json()["subtasks"][0]["title"] == "Intro"
    blank = client.post("/api/assessments", json={"title": "x", "subtasks": [{"title": "   "}]})
    assert blank.status_code == 422
    long = client.post("/api/assessments", json={"title": "x", "subtasks": [{"title": "a" * 101}]})
    assert long.status_code == 422


def test_a_task_has_a_limit_on_steps(client, user):
    many = [{"title": f"Step {i}"} for i in range(41)]
    assert client.post("/api/assessments", json={"title": "x", "subtasks": many}).status_code == 422
    fine = [{"title": f"Step {i}"} for i in range(40)]
    assert client.post("/api/assessments", json={"title": "x", "subtasks": fine}).status_code == 201


def test_arabic_steps_survive(client, user):
    r = client.post("/api/assessments", json={"title": "عرض تقديمي", "subtasks": [{"title": "المقدمة"}, {"title": "الخاتمة"}]})
    assert [s["title"] for s in r.json()["subtasks"]] == ["المقدمة", "الخاتمة"]


def test_you_cannot_read_someone_elses_task(client, user):
    made = client.post("/api/assessments", json=task()).json()
    client.post("/api/auth/logout")
    signup(client, email="bob@example.com")
    assert client.get(f"/api/assessments/{made['id']}").status_code == 404


def test_old_databases_get_the_column(tmp_path):
    from sqlalchemy import create_engine, inspect, text

    from app.migrate import upgrade

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE assessments (id INTEGER PRIMARY KEY, title VARCHAR(100))"))
        conn.execute(text("INSERT INTO assessments (title) VALUES ('Old task')"))
    assert "assessments.subtasks" in upgrade(engine)
    assert "subtasks" in {c["name"] for c in inspect(engine).get_columns("assessments")}
    with engine.begin() as conn:
        assert conn.execute(text("SELECT subtasks FROM assessments")).scalar() == "[]"
