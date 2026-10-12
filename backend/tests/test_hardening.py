"""Security hardening: limits, the Google nonce, deleting an account, the calendar file."""

from datetime import UTC, datetime, timedelta

import jwt

from app.config import get_settings
from app.database import SessionLocal
from app.models import PushSubscription
from app.routers import google as google_router

from .conftest import TERM, signup
from .test_admin import ADMIN, NEW, ready_admin
from .test_google_login import google, sign_in_with_google  # noqa: F401  (the fixture is used below)
from .test_notify import SUB

# ---- public API documentation ------------------------------------------------------------


def test_api_docs_are_off_by_default(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


# ---- Google sign-in: nonce ---------------------------------------------------------------


def test_google_callback_needs_the_cookie_nonce(client, google):  # noqa: F811
    secret = get_settings().secret_key
    soon = datetime.now(UTC) + timedelta(minutes=5)
    state = jwt.encode({"typ": "google-login", "exp": soon}, secret, algorithm="HS256")  # no nonce, no cookie
    r = client.get("/api/auth/google/callback", params={"code": "abc", "state": state}, follow_redirects=False)
    assert r.headers["location"] == "/login?google=expired"
    assert client.get("/api/auth/me").status_code == 401


def test_a_session_cookie_is_not_accepted_as_google_state(client, google):  # noqa: F811
    signup(client, email="victim@example.com")
    session = client.cookies.get("gam3a_session")
    client.cookies.clear()
    r = client.get("/api/auth/google/callback", params={"code": "abc", "state": session}, follow_redirects=False)
    assert r.headers["location"] == "/login?google=expired"


# ---- Google sign-in: linking -------------------------------------------------------------


def test_google_never_replaces_the_google_id_of_an_account(client, google):  # noqa: F811
    sign_in_with_google(client)
    client.post("/api/auth/logout")
    google["sub"] = "g-222"
    r = sign_in_with_google(client)
    assert r.headers["location"] == "/login?google=failed"
    assert client.get("/api/auth/me").status_code == 401


def test_linking_google_removes_devices_registered_before_the_owner_arrived(client, google):  # noqa: F811
    signup(client, email="nour@gmail.com")
    assert client.post("/api/push/subscribe", json=SUB).status_code == 204
    client.post("/api/auth/logout")
    sign_in_with_google(client)
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 0


# ---- deleting an account asks again ------------------------------------------------------


def test_deleting_needs_the_password(client, user):
    assert client.request("DELETE", "/api/auth/me").status_code == 400
    assert client.request("DELETE", "/api/auth/me", json={"password": "wrong"}).status_code == 400
    assert client.get("/api/auth/me").status_code == 200
    assert client.request("DELETE", "/api/auth/me", json={"password": "correct-horse"}).status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_deleting_a_google_account_needs_the_email_typed(client, google):  # noqa: F811
    sign_in_with_google(client)
    assert client.request("DELETE", "/api/auth/me", json={"confirm_email": "other@gmail.com"}).status_code == 400
    assert client.request("DELETE", "/api/auth/me", json={"confirm_email": " Nour@Gmail.com "}).status_code == 204


def test_the_only_admin_cannot_delete_itself(client):
    ready_admin(client)
    assert client.request("DELETE", "/api/auth/me", json={"password": NEW}).status_code == 409
    assert client.post("/api/auth/login", json={**ADMIN, "password": NEW}).status_code == 200


# ---- push devices and calendar sync ------------------------------------------------------


def test_only_a_few_devices_per_account(client, user):
    for i in range(10):
        sub = {"endpoint": f"https://fcm.googleapis.com/fcm/send/d{i}", "keys": SUB["keys"]}
        assert client.post("/api/push/subscribe", json=sub).status_code == 204
    over = {"endpoint": "https://fcm.googleapis.com/fcm/send/one-too-many", "keys": SUB["keys"]}
    r = client.post("/api/push/subscribe", json=over)
    assert r.status_code == 409 and "Limit reached" in r.json()["detail"]
    again = {"endpoint": "https://fcm.googleapis.com/fcm/send/d3", "keys": SUB["keys"]}
    assert client.post("/api/push/subscribe", json=again).status_code == 204


def test_calendar_sync_is_throttled(client, user, monkeypatch):
    from app.models import GoogleLink

    with SessionLocal() as db:
        db.add(GoogleLink(user_id=user["id"], email="x@gmail.com", refresh_token="x"))
        db.commit()
    monkeypatch.setattr(google_router.gc, "sync", lambda *a, **k: None)
    google_router._last_sync.clear()
    assert client.post("/api/google/sync").status_code == 200
    assert client.post("/api/google/sync").status_code == 429


# ---- per-account limits ------------------------------------------------------------------


def test_limits_on_terms_courses_busy_and_tasks(client, user, monkeypatch):
    from app.routers import assessments, busy, courses, terms

    monkeypatch.setattr(terms, "MAX_TERMS", 1)
    first = client.post("/api/terms", json=TERM)
    assert first.status_code == 201
    r = client.post("/api/terms", json={**TERM, "name": "Another"})
    assert r.status_code == 409 and "Limit reached" in r.json()["detail"]

    term_id = first.json()["id"]
    monkeypatch.setattr(courses, "MAX_COURSES", 1)
    assert client.post("/api/courses", json={"term_id": term_id, "name": "Biology"}).status_code == 201
    assert client.post("/api/courses", json={"term_id": term_id, "name": "Chemistry"}).status_code == 409

    monkeypatch.setattr(busy, "MAX_BUSY", 1)
    slot = {"term_id": term_id, "title": "Gym", "weekday": 1, "start": "18:00", "end": "19:00"}
    assert client.post("/api/busy", json=slot).status_code == 201
    assert client.post("/api/busy", json=slot).status_code == 409

    monkeypatch.setattr(assessments, "MAX_ASSESSMENTS", 1)
    assert client.post("/api/assessments", json={"title": "Essay"}).status_code == 201
    assert client.post("/api/assessments", json={"title": "Essay 2"}).status_code == 409


# ---- the calendar (.ics) file ------------------------------------------------------------


def test_calendar_file_cannot_be_injected_through_a_title(client, user):
    term = client.post("/api/terms", json=TERM).json()
    # a bare carriage return is a line break for many calendar programs: it must not survive in a title
    evil = "Quiz\rBEGIN:VEVENT\rSUMMARY:Gotcha\x07"
    client.post("/api/assessments", json={"title": evil, "due_date": "2026-10-10"})
    body = client.get(f"/api/terms/{term['id']}/calendar.ics").text
    assert body.count("\r") == body.count("\r\n")  # every carriage return is the end of a proper line
    assert "\x07" not in body
    lines = body.split("\r\n")
    assert lines.count("BEGIN:VEVENT") == lines.count("END:VEVENT") == 1  # only the real deadline
    assert not any(line.startswith("SUMMARY:Gotcha") for line in lines)


def test_calendar_download_works_for_an_arabic_term_name(client, user):
    term = client.post("/api/terms", json={**TERM, "name": "الفصل الأول"}).json()
    r = client.get(f"/api/terms/{term['id']}/calendar.ics")
    assert r.status_code == 200 and "BEGIN:VCALENDAR" in r.text
    assert 'filename="term.ics"' in r.headers["content-disposition"]
