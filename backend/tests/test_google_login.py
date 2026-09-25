"""'Continue with Google' against a fake Google (no network)."""

import base64
import json
from urllib.parse import parse_qs, urlparse

import pytest

from app.config import get_settings
from app.routers import google_login

from .conftest import signup


def id_token(**claims) -> str:
    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"header.{body}.signature"


@pytest.fixture
def google(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "google_client_id", "client-123")
    monkeypatch.setattr(settings, "google_client_secret", "secret-456")
    account = {"sub": "g-111", "email": "nour@gmail.com", "email_verified": True, "name": "Nour Hassan"}
    monkeypatch.setattr(google_login, "call", lambda method, url, data=None: (200, {"id_token": id_token(**account)}))
    return account


def sign_in_with_google(client, **start):
    r = client.get("/api/auth/google/start", params=start, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].startswith(google_login.AUTH_URL)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    return client.get("/api/auth/google/callback", params={"code": "abc", "state": state}, follow_redirects=False)


def test_button_only_when_set_up(client, monkeypatch):
    assert client.get("/api/health").json()["google"] is False
    assert client.get("/api/auth/google/start", follow_redirects=False).status_code == 503


def test_asks_google_only_for_name_and_email(client, google):
    assert client.get("/api/health").json()["google"] is True
    r = client.get("/api/auth/google/start", follow_redirects=False)
    query = parse_qs(urlparse(r.headers["location"]).query)
    assert query["scope"] == ["openid email profile"]
    assert query["redirect_uri"] == ["http://testserver/api/auth/google/callback"]


def test_first_time_makes_an_account(client, google):
    r = sign_in_with_google(client, tz="Asia/Dubai", lang="ar", currency="AED")
    assert r.headers["location"] == "/"
    me = client.get("/api/auth/me").json()
    assert (me["email"], me["name"], me["timezone"], me["lang"]) == ("nour@gmail.com", "Nour Hassan", "Asia/Dubai", "ar")
    assert me["has_password"] is False


def test_password_sign_in_points_to_google_until_a_password_is_set(client, google):
    sign_in_with_google(client)
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json={"email": "nour@gmail.com", "password": "anything123"})
    assert r.status_code == 401 and "Google" in r.json()["detail"]
    sign_in_with_google(client)
    assert client.post("/api/auth/password", json={"new_password": "my-new-password"}).status_code == 204
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"email": "nour@gmail.com", "password": "my-new-password"}).status_code == 200


def test_existing_account_is_linked_not_duplicated(client, google):
    mine = signup(client, email="nour@gmail.com")
    client.post("/api/auth/logout")
    sign_in_with_google(client)
    assert client.get("/api/auth/me").json()["id"] == mine["id"]
    # later, even if the Google account's email changes, it's the same person
    google["email"] = "nour.new@gmail.com"
    client.post("/api/auth/logout")
    sign_in_with_google(client)
    assert client.get("/api/auth/me").json()["id"] == mine["id"]


def test_closed_signups_stop_new_accounts_only(client, google, monkeypatch):
    monkeypatch.setattr(get_settings(), "allow_signup", False)
    assert sign_in_with_google(client).headers["location"] == "/login?google=closed"
    assert client.get("/api/auth/me").status_code == 401
    monkeypatch.setattr(get_settings(), "allow_signup", True)
    signup(client, email="nour@gmail.com")
    client.post("/api/auth/logout")
    monkeypatch.setattr(get_settings(), "allow_signup", False)
    assert sign_in_with_google(client).headers["location"] == "/"


def test_unverified_email_is_refused(client, google):
    google["email_verified"] = False
    assert sign_in_with_google(client).headers["location"] == "/login?google=unverified"


def test_must_finish_in_the_browser_that_started(client, google):
    r = client.get("/api/auth/google/start", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    client.cookies.clear()  # a different browser
    back = client.get("/api/auth/google/callback", params={"code": "abc", "state": state}, follow_redirects=False)
    assert back.headers["location"] == "/login?google=expired"
    assert client.get("/api/auth/me").status_code == 401
    r = client.get("/api/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert r.headers["location"] == "/login?google=cancelled"
