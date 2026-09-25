import pytest

from .conftest import add_course

LECTURE = {"weekday": 6, "start": "10:00", "end": "11:30", "kind": "lecture", "location": "Hall 3"}


def test_course_with_meetings_crud(client, term):
    c = add_course(client, term["id"], code="CSE221", meetings=[LECTURE])
    assert c["meetings"][0]["location"] == "Hall 3"
    body = {**c, "meetings": [LECTURE, {**LECTURE, "weekday": 1, "kind": "section"}]}
    updated = client.put(f"/api/courses/{c['id']}", json=body).json()
    assert [m["kind"] for m in updated["meetings"]] == ["section", "lecture"]  # sorted by weekday
    assert client.delete(f"/api/courses/{c['id']}").status_code == 204
    assert client.get("/api/courses", params={"term_id": term["id"]}).json() == []


def test_meeting_must_end_after_start(client, term):
    r = client.post("/api/courses", json={"term_id": term["id"], "name": "X", "meetings": [{**LECTURE, "end": "09:00"}]})
    assert r.status_code == 422


def test_grades_are_validated_against_scale(client, term):
    c = add_course(client, term["id"])
    assert client.put(f"/api/courses/{c['id']}/grade", json={"grade": "b+"}).json()["grade"] == "B+"
    assert client.put(f"/api/courses/{c['id']}/grade", json={"grade": "Z"}).status_code == 422
    assert client.put(f"/api/courses/{c['id']}/grade", json={"grade": None}).json()["grade"] is None


def test_gpa_and_cgpa_across_terms(client, user):
    t1 = client.post("/api/terms", json={"name": "T1", "start_date": "2025-09-01", "end_date": "2025-12-31"}).json()
    t2 = client.post("/api/terms", json={"name": "T2", "start_date": "2026-02-01", "end_date": "2026-05-31"}).json()
    add_course(client, t1["id"], "A", 3, grade="A")  # 12
    add_course(client, t1["id"], "B", 3, grade="B")  # 9
    add_course(client, t2["id"], "C", 4, grade="C")  # 8
    add_course(client, t2["id"], "D", 2)  # in progress
    g = client.get("/api/grades").json()
    assert [t["gpa"] for t in g["terms"]] == [3.5, 2.0]
    assert g["terms"][1]["cgpa"] == round(29 / 10, 3)
    assert g["terms"][0]["cgpa_before"] is None  # first term: nothing before it
    assert g["terms"][1]["cgpa_before"] == 3.5  # = CGPA after T1
    assert g["terms"][1]["in_progress"] == 1
    assert g["cgpa"] == 2.9 and g["total_credits"] == 10


def test_assessments_and_course_score(client, term):
    c = add_course(client, term["id"])
    base = {"course_id": c["id"], "kind": "quiz"}
    client.post("/api/assessments", json={**base, "title": "Q1", "weight": 10, "score": 80, "done": True, "due_date": "2026-10-01"})
    client.post("/api/assessments", json={**base, "title": "Q2", "weight": 30, "score": 60, "done": True, "due_date": "2026-10-08"})
    client.post("/api/assessments", json={**base, "title": "Final", "weight": 60, "due_date": "2026-12-20"})
    client.post("/api/assessments", json={**base, "title": "Someday"})
    course = client.get("/api/courses").json()[0]
    assert course["progress"]["current"] == 65.0 and course["progress"]["graded_weight"] == 40
    upcoming = client.get("/api/assessments", params={"open_only": True, "start": "2026-10-02"}).json()
    assert [a["title"] for a in upcoming] == ["Final"]
    everything = client.get("/api/assessments", params={"term_id": term["id"]}).json()
    assert everything[-1]["title"] == "Someday"  # undated last


def test_plan_blocks_conflicts_and_calendar(client, term):
    ds = add_course(client, term["id"], code="CSE221", meetings=[LECTURE])
    add_course(client, term["id"], code="MTH203", credits=2,
               meetings=[{**LECTURE, "start": "11:00", "end": "12:00"}])  # clashes with CSE221
    add_course(client, term["id"], code="OLD", credits=3, grade="A")  # finished: no study time
    client.post("/api/busy", json={"term_id": term["id"], "title": "Job", "weekday": 3, "start": "16:00", "end": "20:00"})

    plan = client.get(f"/api/terms/{term['id']}/plan").json()
    kinds = [b["kind"] for b in plan["blocks"]]
    assert kinds.count("class") == 2 and kinds.count("busy") == 1
    assert plan["study_minutes"] == (3 + 2) * 2 * 60
    assert {b["title"] for b in plan["blocks"] if b["kind"] == "study"} == {"CSE221", "MTH203"}
    assert len(plan["conflicts"]) == 1
    # Saturday-first week: blocks come in week order
    order = [5, 6, 0, 1, 2, 3, 4]
    days = [order.index(b["weekday"]) for b in plan["blocks"]]
    assert days == sorted(days)
    # no study during the job or on Friday (default rest day)
    for b in plan["blocks"]:
        if b["kind"] == "study":
            assert b["weekday"] != 4
            assert not (b["weekday"] == 3 and b["start"] < "20:15" and b["end"] > "16:00")

    client.post("/api/assessments", json={"course_id": ds["id"], "title": "Midterm", "due_date": "2026-11-01", "due_time": "10:00"})
    ics = client.get(f"/api/terms/{term['id']}/calendar.ics")
    assert ics.headers["content-type"].startswith("text/calendar")
    text = ics.text
    assert text.startswith("BEGIN:VCALENDAR") and text.rstrip().endswith("END:VCALENDAR")
    assert "RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z" in text
    assert "DTSTART:20260920T100000" in text  # first Sunday on/after 2026-09-19
    assert "LOCATION:Hall 3" in text
    assert "SUMMARY:Midterm — CSE221" in text
    assert "Study: " not in client.get(f"/api/terms/{term['id']}/calendar.ics", params={"study": False}).text


def test_deleting_term_cascades(client, term):
    c = add_course(client, term["id"], meetings=[LECTURE])
    client.post("/api/assessments", json={"course_id": c["id"], "title": "HW"})
    assert client.delete(f"/api/terms/{term['id']}").status_code == 204
    assert client.get("/api/courses").json() == []
    assert client.get("/api/assessments").json() == []


def test_raw_marks_become_scores(client, term):
    c = add_course(client, term["id"])
    r = client.post("/api/assessments", json={"course_id": c["id"], "title": "Project", "weight": 30,
                                              "points_earned": 28, "points_max": 30})
    item = r.json()
    assert item["score"] == pytest.approx(93.3333, abs=0.001) and item["done"] is True
    assert client.post("/api/assessments", json={"course_id": c["id"], "title": "X", "points_earned": 3}).status_code == 422
    assert client.post("/api/assessments", json={"course_id": c["id"], "title": "X", "points_earned": 50,
                                                 "points_max": 5}).status_code == 422


def test_required_to_reach_target(client, term):
    # Aim for an A (93%). Project 28/30 worth 30%, Quiz 1 3/5 worth 10%.
    c = add_course(client, term["id"], target_grade="a")
    assert c["target_grade"] == "A"
    base = {"course_id": c["id"]}
    client.post("/api/assessments", json={**base, "title": "Project", "weight": 30, "points_earned": 28, "points_max": 30})
    client.post("/api/assessments", json={**base, "title": "Quiz 1", "weight": 10, "points_earned": 3, "points_max": 5})
    client.post("/api/assessments", json={**base, "title": "Final", "weight": 60, "points_max": 60})
    p = client.get(f"/api/courses/{c['id']}").json()["progress"]
    # earned = 28 + 6 = 34 of the 40% marked so far
    assert p["earned"] == 34.0 and p["graded_weight"] == 40 and p["remaining_weight"] == 60
    assert p["current"] == 85.0 and p["current_letter"] == "B"  # B+ starts at 87
    # need (93 - 34) / 60 = 98.33% on the rest
    assert p["required"] == pytest.approx(98.33, abs=0.01)
    assert p["target_percent"] == 93 and p["status"] == "needs"
    assert p["max_possible"] == 94.0 and p["max_letter"] == "A"


def test_secured_and_out_of_reach(client, term):
    c = add_course(client, term["id"], target_grade="A+")
    client.post("/api/assessments", json={"course_id": c["id"], "title": "Midterm", "weight": 50, "score": 80})
    p = client.get(f"/api/courses/{c['id']}").json()["progress"]
    assert p["status"] == "out_of_reach" and p["max_possible"] == 90  # 97 no longer possible
    c2 = add_course(client, term["id"], target_grade="B")
    client.post("/api/assessments", json={"course_id": c2["id"], "title": "Everything", "weight": 90, "score": 100})
    assert client.get(f"/api/courses/{c2['id']}").json()["progress"]["status"] == "secured"


def test_default_target_and_custom_cutoffs(client, term):
    c = add_course(client, term["id"])
    assert c["progress"]["target_grade"] == "A" and c["progress"]["target_percent"] == 93
    me = client.patch("/api/auth/me", json={"cutoffs": {"A": 91, "A+": 95}, "default_target": "A+"}).json()
    assert me["cutoffs"]["A"] == 91 and me["cutoffs"]["A-"] == 90  # untouched letters keep defaults
    assert me["default_target"] == "A+"
    assert client.get(f"/api/courses/{c['id']}").json()["progress"]["target_percent"] == 95
    # A cut-off that isn't above the grade below it is rejected
    assert client.patch("/api/auth/me", json={"cutoffs": {"A": 90}}).status_code == 422
    assert client.put(f"/api/courses/{c['id']}", json={**c, "target_grade": "P"}).status_code == 422
