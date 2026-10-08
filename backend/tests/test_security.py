"""Protections that apply to the whole site."""

from .conftest import signup


def test_security_headers_on_pages_and_api(client):
    r = client.get("/api/health")
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert "script-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"


def test_wrong_passwords_are_throttled(client):
    signup(client, email="ada@example.com", password="correct-horse")
    client.post("/api/auth/logout")
    wrong = {"email": "ada@example.com", "password": "guess-guess"}
    for _ in range(10):
        assert client.post("/api/auth/login", json=wrong).status_code == 401
    assert client.post("/api/auth/login", json=wrong).status_code == 429
    # even the right password waits now, so guessing can't go on
    right = {"email": "ada@example.com", "password": "correct-horse"}
    assert client.post("/api/auth/login", json=right).status_code == 429
    # other accounts are not affected
    signup(client, email="bob@example.com", password="bobs-password")


def test_too_long_password_is_refused_not_a_crash(client):
    r = client.post("/api/auth/register", json={"email": "a@example.com", "name": "A", "password": "ب" * 60})
    assert r.status_code == 422
    signup(client, email="b@example.com", password="correct-horse")
    assert client.post("/api/auth/login", json={"email": "b@example.com", "password": "x" * 120}).status_code == 401


def test_push_only_to_real_push_services(client):
    signup(client)
    keys = {"p256dh": "k", "auth": "a"}
    for endpoint in (
        "https://127.0.0.1/x",
        "https://localhost:8102/api/admin",
        "https://fcm.googleapis.com.evil.example/x",
        "https://fcm.googleapis.com:8443/x",
    ):
        r = client.post("/api/push/subscribe", json={"endpoint": endpoint, "keys": keys})
        assert r.status_code == 422, endpoint
    for endpoint in (
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://web.push.apple.com/abc",
        "https://wns2-by3p.notify.windows.com/w/?token=abc",
    ):
        r = client.post("/api/push/subscribe", json={"endpoint": endpoint, "keys": keys})
        assert r.status_code == 204, endpoint
