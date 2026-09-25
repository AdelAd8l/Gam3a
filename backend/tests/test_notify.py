import json
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from pywebpush import WebPushException

from app import notify
from app.database import SessionLocal
from app.models import PushSubscription

from .conftest import add_course

CAIRO = ZoneInfo("Africa/Cairo")
SUB = {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "BPk3", "auth": "a1"}}
MONDAY = {"weekday": 0, "start": "10:00", "end": "11:40", "kind": "lecture", "location": "Hall 3"}


@pytest.fixture
def pushed(monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "webpush", lambda info, data, **kw: sent.append(json.loads(data)))
    return sent


def run(when: datetime) -> int:
    with SessionLocal() as db:
        return notify.run_once(db, when)


def cairo(day: int, hour: int, minute: int) -> datetime:
    return datetime(2026, 9, day, hour, minute, tzinfo=CAIRO)


def test_key_is_stable(client):
    first = client.get("/api/push/key").json()["public_key"]
    assert len(first) == 87  # 65 raw bytes, base64url without padding
    assert client.get("/api/push/key").json()["public_key"] == first


def test_class_reminder_is_sent_once_before_class(client, term, pushed):
    add_course(client, term["id"], code="CSE221", meetings=[MONDAY])
    assert client.post("/api/push/subscribe", json=SUB).status_code == 204
    assert run(cairo(28, 9, 40)) == 0  # 2026-09-28 is a Monday; 20 min early, lead is 15
    assert run(cairo(28, 9, 46)) == 1
    assert pushed[0]["title"] == "CSE221 · Lecture in 14 min"
    assert "Hall 3" in pushed[0]["body"]
    assert run(cairo(28, 9, 50)) == 0  # already sent
    assert run(cairo(28, 10, 1)) == 0  # class started
    assert run(cairo(29, 9, 50)) == 0  # Tuesday: no class


def test_reminders_follow_the_users_time_zone_and_language(client, term, pushed):
    add_course(client, term["id"], code="CSE221", meetings=[MONDAY])
    client.patch("/api/auth/me", json={"timezone": "Asia/Dubai", "lang": "ar"})
    client.post("/api/push/subscribe", json=SUB)
    assert run(datetime(2026, 9, 28, 5, 50, tzinfo=ZoneInfo("UTC"))) == 1  # 09:50 in Dubai
    assert pushed[0]["title"].startswith("محاضرة CSE221")


def test_deadline_reminders(client, term, pushed):
    c = add_course(client, term["id"], code="MTH203")
    base = {"course_id": c["id"], "kind": "quiz"}
    client.post("/api/assessments", json={**base, "title": "Quiz 1", "due_date": "2026-09-29"})  # no time
    client.post("/api/assessments", json={**base, "title": "Quiz 2", "due_date": "2026-09-29", "due_time": "23:59"})
    client.post("/api/assessments", json={**base, "title": "Done one", "due_date": "2026-09-29", "done": True})
    client.post("/api/push/subscribe", json=SUB)
    assert run(cairo(28, 8, 59)) == 0
    assert run(cairo(28, 9, 0)) == 1  # untimed = 09:00, one day before
    assert pushed[-1]["title"] == "Quiz 1 is due tomorrow"
    assert run(cairo(28, 23, 59)) == 1
    assert pushed[-1]["title"] == "Quiz 2 is due tomorrow"
    assert run(cairo(29, 12, 0)) == 0


def test_moving_a_deadline_sends_a_new_reminder(client, term, pushed):
    c = add_course(client, term["id"])
    item = client.post("/api/assessments", json={"course_id": c["id"], "title": "HW", "due_date": "2026-09-29"}).json()
    client.post("/api/push/subscribe", json=SUB)
    assert run(cairo(28, 9, 0)) == 1
    client.put(f"/api/assessments/{item['id']}", json={**item, "due_date": "2026-09-30"})
    assert run(cairo(29, 9, 0)) == 1


def test_switched_off_reminders(client, term, pushed):
    add_course(client, term["id"], meetings=[MONDAY])
    client.patch("/api/auth/me", json={"notify_classes": False})
    client.post("/api/push/subscribe", json=SUB)
    assert run(cairo(28, 9, 50)) == 0


def test_gone_devices_are_forgotten(client, term, monkeypatch):
    def gone(*_, **__):
        raise WebPushException("gone", response=SimpleNamespace(status_code=410, text=""))

    monkeypatch.setattr(notify, "webpush", gone)
    client.post("/api/push/subscribe", json=SUB)
    assert client.post("/api/push/test").status_code == 409
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 0


def test_test_notification_and_unsubscribe(client, user, pushed):
    assert client.post("/api/push/test").status_code == 409
    client.post("/api/push/subscribe", json=SUB)
    assert client.post("/api/push/test").json() == {"sent": 1}
    client.post("/api/push/unsubscribe", json={"endpoint": SUB["endpoint"]})
    assert client.post("/api/push/test").status_code == 409


def test_settings_validation(client, user):
    assert client.patch("/api/auth/me", json={"timezone": "Mars/Base"}).status_code == 422
    me = client.patch("/api/auth/me", json={"timezone": "Asia/Dubai", "class_lead": 30, "deadline_lead": 180}).json()
    assert (me["timezone"], me["class_lead"], me["deadline_lead"]) == ("Asia/Dubai", 30, 180)


def test_signup_keeps_the_phones_time_zone(client):
    body = {"email": "dubai@example.com", "name": "D", "password": "password123", "timezone": "Asia/Dubai"}
    assert client.post("/api/auth/register", json=body).json()["timezone"] == "Asia/Dubai"
    client.post("/api/auth/logout")
    bad = {**body, "email": "mars@example.com", "timezone": "Mars/Base"}
    assert client.post("/api/auth/register", json=bad).status_code == 422
    plain = {k: v for k, v in body.items() if k != "timezone"} | {"email": "cairo@example.com"}
    assert client.post("/api/auth/register", json=plain).json()["timezone"] == "Africa/Cairo"


def test_offline_phones_get_class_reminders_only_until_class_starts(client, term, monkeypatch):
    kept_for = []
    monkeypatch.setattr(notify, "webpush", lambda info, data, **kw: kept_for.append(kw["ttl"]))
    add_course(client, term["id"], code="CSE221", meetings=[MONDAY])
    client.post("/api/push/subscribe", json=SUB)
    run(cairo(28, 9, 46))
    assert kept_for == [14 * 60]  # dropped once the 10:00 lecture has started


def test_time_zone_is_automatic_until_picked_by_hand(client, user):
    assert client.get("/api/auth/me").json()["timezone_auto"] is True
    me = client.patch("/api/auth/me", json={"timezone": "Asia/Dubai", "timezone_auto": False}).json()
    assert (me["timezone"], me["timezone_auto"]) == ("Asia/Dubai", False)
