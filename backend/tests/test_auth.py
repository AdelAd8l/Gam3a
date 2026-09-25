from fastapi.testclient import TestClient

from app.main import app

from .conftest import TERM, add_course, signup


def test_register_sets_session(client, user):
    assert user["email"] == "ada@example.com"
    me = client.get("/api/auth/me").json()
    assert me["name"] == "Ada" and me["scale"] == "4" and me["week_start"] == 5
    assert me["class_minutes"] == 100  # 1 h 40 min


def test_duplicate_email_is_rejected(client, user):
    r = client.post("/api/auth/register", json={"email": "ADA@example.com", "name": "x", "password": "12345678"})
    assert r.status_code == 409


def test_short_password_is_rejected(client):
    r = client.post("/api/auth/register", json={"email": "a@b.co", "name": "x", "password": "short"})
    assert r.status_code == 422


def test_login_logout(client, user):
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "ada@example.com", "password": "nope-nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "ada@example.com", "password": "correct-horse"}).status_code == 200


def test_tampered_cookie_is_rejected(client):
    client.cookies.set("gam3a_session", "not-a-jwt")
    assert client.get("/api/auth/me").status_code == 401


def test_update_profile_and_password(client, user):
    r = client.patch("/api/auth/me", json={"university": "Faculty of Engineering", "scale": "5", "week_start": 6})
    assert r.json()["scale"] == "5" and r.json()["week_start"] == 6
    assert client.patch("/api/auth/me", json={"scale": "7"}).status_code == 422
    assert client.patch("/api/auth/me", json={"class_minutes": 90}).json()["class_minutes"] == 90
    assert client.patch("/api/auth/me", json={"class_minutes": 5}).status_code == 422
    bad = client.post("/api/auth/password", json={"current_password": "nope", "new_password": "new-password"})
    assert bad.status_code == 400


def test_users_cannot_see_each_others_data(client, term):
    course = add_course(client, term["id"])
    with TestClient(app) as other:
        signup(other, email="bob@example.com")
        assert other.get("/api/terms").json() == []
        assert other.get("/api/courses").json() == []
        assert other.get(f"/api/terms/{term['id']}/plan").status_code == 404
        assert other.delete(f"/api/courses/{course['id']}").status_code == 404
        r = other.post("/api/courses", json={"term_id": term["id"], "name": "Sneaky"})
        assert r.status_code == 404


def test_delete_account_removes_everything(client, term):
    add_course(client, term["id"], meetings=[{"weekday": 0, "start": "09:00", "end": "10:00"}])
    client.post("/api/busy", json={"term_id": term["id"], "title": "Gym", "weekday": 1, "start": "18:00", "end": "19:00"})
    assert client.delete("/api/auth/me").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    signup(client)  # email is free again
    assert client.get("/api/terms").json() == []


def test_signup_can_be_closed(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "allow_signup", False)
    r = client.post("/api/auth/register", json={"email": "x@example.com", "name": "x", "password": "12345678"})
    assert r.status_code == 403
    assert client.get("/api/health").json()["signup"] is False


def test_term_validation(client, user):
    bad_dates = {**TERM, "end_date": "2026-09-01"}
    assert client.post("/api/terms", json=bad_dates).status_code == 422
    bad_hours = {**TERM, "study_start": "22:00", "study_end": "09:00"}
    assert client.post("/api/terms", json=bad_hours).status_code == 422
