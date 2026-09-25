"""Google Calendar sync against a fake Google (no network)."""

import base64
import json
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from app import google_calendar as gc
from app.config import get_settings
from app.database import SessionLocal
from app.models import GoogleLink, User

from .conftest import add_course

LECTURE = {"weekday": 0, "start": "10:00", "end": "11:40", "kind": "lecture", "location": "Hall 3"}


class FakeGoogle:
    """Just enough of Google's OAuth and Calendar API to exercise the sync."""

    def __init__(self):
        self.calendars: dict[str, dict] = {}  # id -> {"body":…, "color":…, "events": {id: body}}
        self.calls: list[tuple[str, str]] = []
        self.revoked = False
        self.revoke_calls = 0
        self.n = 0

    def _id(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"

    def __call__(self, method, url, *, token=None, params=None, json_body=None, data=None):
        if url == gc.TOKEN_URL:
            if data["grant_type"] == "authorization_code":
                payload = base64.urlsafe_b64encode(json.dumps({"email": "adel@gmail.com"}).encode()).decode()
                return 200, {"access_token": "at", "expires_in": 3600, "refresh_token": "rt", "id_token": f"x.{payload}.y"}
            if self.revoked:
                return 400, {"error": "invalid_grant"}
            return 200, {"access_token": "at2", "expires_in": 3600}
        if url == gc.REVOKE_URL:
            self.revoke_calls += 1
            return 200, {}
        path = url.removeprefix(gc.API)
        self.calls.append((method, path))
        parts = path.strip("/").split("/")
        if parts[0] == "users":  # /users/me/calendarList/{id}
            cal = self.calendars.get(parts[3])
            if cal is None:
                return 404, {}
            cal["color"] = (json_body["backgroundColor"], json_body["foregroundColor"])
            return 200, {}
        if parts == ["calendars"] and method == "POST":
            cid = self._id("cal")
            self.calendars[cid] = {"body": json_body, "color": None, "events": {}}
            return 200, {"id": cid}
        cal = self.calendars.get(parts[1])
        if cal is None:
            return 404, {}
        if len(parts) == 2:
            if method == "PATCH":
                cal["body"] = {**cal["body"], **json_body}
            elif method == "DELETE":
                del self.calendars[parts[1]]
            return 200, {}
        if len(parts) == 3 and method == "POST":
            eid = self._id("ev")
            cal["events"][eid] = json_body
            return 200, {"id": eid}
        eid = parts[3]
        if eid not in cal["events"]:
            return 404, {}
        if method == "PUT":
            cal["events"][eid] = json_body
        elif method == "DELETE":
            del cal["events"][eid]
        return 200, {}

    def all_events(self):
        return [e for c in self.calendars.values() for e in c["events"].values()]


@pytest.fixture
def google(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "client-123")
    monkeypatch.setattr(settings, "google_client_secret", "secret-456")
    fake = FakeGoogle()
    monkeypatch.setattr(gc, "call", fake)
    gc._tokens.clear()
    return fake


def connect(client):
    r = client.get("/api/google/connect", follow_redirects=False)
    assert r.status_code == 302
    query = parse_qs(urlparse(r.headers["location"]).query)
    back = client.get("/api/google/callback", params={"code": "abc", "state": query["state"][0]}, follow_redirects=False)
    assert back.headers["location"] == "/settings?google=connected"
    return query


def sync(user_id):
    with SessionLocal() as db:
        return gc.sync(db, db.get(User, user_id))


def test_hidden_until_the_server_is_set_up(client, user):
    assert client.get("/api/google/status").json()["configured"] is False
    assert client.get("/api/google/connect", follow_redirects=False).status_code == 503


def test_connect_sends_to_google_and_back(client, term, google):
    add_course(client, term["id"], code="CSE221", color="#E91E63", meetings=[LECTURE])
    query = connect(client)
    assert query["client_id"] == ["client-123"]
    assert query["redirect_uri"] == ["http://testserver/api/google/callback"]
    assert query["access_type"] == ["offline"]
    status = client.get("/api/google/status").json()
    assert status["connected"] and status["email"] == "adel@gmail.com" and status["last_error"] == ""
    # one calendar for the course, in its color, with the weekly class
    (cal,) = google.calendars.values()
    assert cal["body"]["summary"] == "CSE221 · Data Structures"
    assert cal["color"] == ("#E91E63", "#FFFFFF")
    (event,) = [e for e in cal["events"].values() if e["summary"].endswith("Lecture")]
    assert event["summary"] == "CSE221 · Lecture" and event["location"] == "Hall 3"
    assert event["start"] == {"dateTime": "2026-09-21T10:00:00", "timeZone": "Africa/Cairo"}  # first Monday of term
    assert event["recurrence"] == ["RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z"]
    assert event["reminders"] == {"useDefault": False, "overrides": [{"method": "popup", "minutes": 10}]}


def test_the_refresh_token_is_stored_encrypted(client, term, google):
    connect(client)
    with SessionLocal() as db:
        link = db.scalars(select(GoogleLink)).one()
        assert "rt" not in link.refresh_token
        assert gc.unseal(link.refresh_token) == "rt"


def test_nothing_is_sent_when_nothing_changed(client, term, google, user):
    add_course(client, term["id"], meetings=[LECTURE])
    connect(client)
    google.calls.clear()
    assert sync(user["id"]) is False
    assert google.calls == []


def test_changes_are_mirrored(client, term, google, user):
    course = add_course(client, term["id"], code="MTH203", color="#3E5C8A", meetings=[LECTURE])
    item = client.post(
        "/api/assessments", json={"course_id": course["id"], "title": "Quiz 1", "due_date": "2026-10-01", "due_time": "12:00"}
    ).json()
    connect(client)
    quiz = next(e for e in google.all_events() if e["summary"].startswith("Quiz 1"))
    assert quiz["end"] == {"dateTime": "2026-10-01T12:00:00", "timeZone": "Africa/Cairo"}

    # new color: only the color changes on Google
    client.put(f"/api/courses/{course['id']}", json={**course, "color": "#F5D76E"})
    google.calls.clear()
    assert sync(user["id"])
    assert [c["color"] for c in google.calendars.values()] == [("#F5D76E", "#1B1B18")]  # dark text on light color
    assert all(path.startswith("/users/me/calendarList") or path.startswith("/calendars/cal") for _, path in google.calls)
    assert not any(method == "POST" for method, _ in google.calls)

    # a deadline marked done is renamed; a deleted one disappears
    client.put(f"/api/assessments/{item['id']}", json={**item, "done": True})
    sync(user["id"])
    assert any(e["summary"].startswith("✓ Quiz 1") for e in google.all_events())
    client.delete(f"/api/assessments/{item['id']}")
    sync(user["id"])
    assert not any("Quiz 1" in e["summary"] for e in google.all_events())

    # deleting the course removes its calendar
    client.delete(f"/api/courses/{course['id']}")
    sync(user["id"])
    assert google.calendars == {}


def test_study_sessions_can_be_left_out(client, term, google, user):
    add_course(client, term["id"], meetings=[LECTURE])
    connect(client)
    with_study = len(google.all_events())
    assert any(e["summary"].startswith("Study") for e in google.all_events())
    client.put("/api/google/settings", json={"include_study": False})
    assert not any(e["summary"].startswith("Study") for e in google.all_events())
    assert len(google.all_events()) < with_study


def test_a_calendar_deleted_on_google_is_made_again(client, term, google, user):
    add_course(client, term["id"], meetings=[LECTURE])
    connect(client)
    google.calendars.clear()  # the person deleted it in Google Calendar
    client.post("/api/google/sync")
    (cal,) = google.calendars.values()
    assert any(e["summary"].endswith("Lecture") for e in cal["events"].values())


def test_removed_access_is_reported_and_not_retried(client, term, google, user):
    add_course(client, term["id"], meetings=[LECTURE])
    connect(client)
    google.revoked = True
    gc._tokens.clear()
    client.post(f"/api/courses/{client.get('/api/courses').json()[0]['id']}/grade", json={"grade": "A"})
    client.put("/api/google/settings", json={"include_study": False})  # a change that needs Google
    assert client.get("/api/google/status").json()["last_error"] == gc.REVOKED
    google.calls.clear()
    with SessionLocal() as db:
        gc.sync_due(db)
    assert google.calls == []  # not retried every minute


def test_disconnect_can_remove_the_calendars(client, term, google):
    add_course(client, term["id"], meetings=[LECTURE])
    connect(client)
    status = client.post("/api/google/disconnect", params={"remove_calendars": True}).json()
    assert status["connected"] is False
    assert google.calendars == {}
    assert google.revoke_calls == 1


def test_a_tampered_or_old_state_is_refused(client, user, google):
    r = client.get("/api/google/callback", params={"code": "abc", "state": "not-a-real-state"}, follow_redirects=False)
    assert r.headers["location"] == "/settings?google=expired"
    r = client.get("/api/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert r.headers["location"] == "/settings?google=cancelled"


def test_background_sync_rebuilds_a_calendar_deleted_on_google(client, term, google, user):
    course = add_course(client, term["id"], meetings=[LECTURE])
    connect(client)
    google.calendars.clear()  # deleted in Google Calendar
    client.post("/api/assessments", json={"course_id": course["id"], "title": "HW", "due_date": "2026-10-01"})
    with SessionLocal() as db:
        gc.sync_due(db)  # notices the calendar is gone
        gc.sync_due(db)  # and makes it again, with everything in it
    (cal,) = google.calendars.values()
    summaries = [e["summary"] for e in cal["events"].values()]
    assert any(s.endswith("Lecture") for s in summaries) and any(s.startswith("HW") for s in summaries)
    assert client.get("/api/google/status").json()["last_error"] == ""


def _reminder(event):
    overrides = event["reminders"]["overrides"]
    return overrides[0]["minutes"] if overrides else None


def test_calendar_reminders_before_classes_and_deadlines(client, term, google, user):
    course = add_course(client, term["id"], code="MTH203", meetings=[LECTURE])
    for body in (
        {"title": "Timed", "due_date": "2026-10-01", "due_time": "23:59"},
        {"title": "Untimed", "due_date": "2026-10-02"},
        {"title": "Finished", "due_date": "2026-10-03", "done": True},
    ):
        client.post("/api/assessments", json={"course_id": course["id"], **body})
    connect(client)
    events = {e["summary"].split(" · ")[0]: e for e in google.all_events()}
    assert _reminder(events["MTH203"]) == 10  # the lecture
    # a timed deadline: the event starts 30 min before it is due, so 1 day before the due time
    assert _reminder(events["Timed"]) == 1440 - 30
    # no time: due at 09:00, so 09:00 the day before = 15 h before that day's midnight
    assert _reminder(events["Untimed"]) == 1440 - 9 * 60
    assert _reminder(events["✓ Finished"]) is None  # nothing to remind once it's done
    study = next(e for e in google.all_events() if e["summary"].startswith("Study"))
    assert _reminder(study) is None


def test_reminder_times_can_be_changed_or_turned_off(client, term, google, user):
    course = add_course(client, term["id"], code="MTH203", meetings=[LECTURE])
    client.post("/api/assessments", json={"course_id": course["id"], "title": "HW", "due_date": "2026-10-02"})
    connect(client)
    status = client.put("/api/google/settings", json={"class_reminder": 30, "deadline_reminder": 0}).json()
    assert (status["class_reminder"], status["deadline_reminder"]) == (30, 0)
    events = {e["summary"].split(" · ")[0]: e for e in google.all_events()}
    assert _reminder(events["MTH203"]) == 30
    assert _reminder(events["HW"]) is None
    assert client.put("/api/google/settings", json={"class_reminder": -5}).status_code == 422
