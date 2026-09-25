"""Google Calendar sync: one calendar per course, in the course's own color.

How it works:

- Connecting uses Google's standard OAuth "web server" flow. We keep only the refresh token,
  encrypted with the server's secret key.
- `desired(db, user)` lists everything that should be on Google: a calendar per course of the
  current and upcoming terms, weekly class events (and study sessions if wanted), and deadlines.
  Each event has a stable key: "a7" = assessment 7, "m<course>-<day>-<times>-<kind>" = a weekly class.
- `sync(db, user)` compares that with what we sent last time (the digests stored in
  google_calendars / google_events) and only creates, updates or deletes what changed.
- The background loop calls `sync_due` every minute; it does nothing unless something changed.

Every call to Google goes through `call()`, which tests replace with a fake Google.
"""

import base64
import hashlib
import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Assessment, Course, GoogleCalendar, GoogleEvent, GoogleLink, Meeting, Term, User

log = logging.getLogger("gam3a.google")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/calendar/v3"
# Calendars (to create one per course and set its color) + the account's email address.
SCOPES = "https://www.googleapis.com/auth/calendar openid email"

_locks: dict[int, threading.Lock] = {}
_tokens: dict[int, tuple[str, datetime]] = {}  # user id -> (access token, expiry)


REVOKED = "Google access was removed. Connect again to keep syncing."
RECONNECT = "Connect Google Calendar again"


class GoogleError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class AccessRevoked(GoogleError):
    """The person removed Gam3a's access in their Google account (or it expired)."""


def configured() -> bool:
    s = get_settings()
    return bool(s.google_client_id and s.google_client_secret)


# ---- HTTP -------------------------------------------------------------------------------


def call(method: str, url: str, *, token: str | None = None, params=None, json_body=None, data=None):
    """One request to Google. Returns (status, parsed JSON or {})."""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = requests.request(method, url, headers=headers, params=params, json=json_body, data=data, timeout=20)
    try:
        body = r.json() if r.content else {}
    except ValueError:
        body = {}
    return r.status_code, body


def _api(user_id: int, refresh_token: str, method: str, path: str, **kw):
    status, body = call(method, API + path, token=_access_token(user_id, refresh_token), **kw)
    if status == 401:  # token expired early: get a new one once
        _tokens.pop(user_id, None)
        status, body = call(method, API + path, token=_access_token(user_id, refresh_token), **kw)
    if status >= 400 and status not in (404, 410):
        message = (body.get("error") or {}).get("message", "") if isinstance(body.get("error"), dict) else ""
        raise GoogleError(status, message or f"Google answered {status}")
    return status, body


# ---- tokens -------------------------------------------------------------------------------


def _fernet() -> Fernet:
    key = hashlib.sha256(("google:" + get_settings().secret_key).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def seal(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def unseal(sealed: str) -> str | None:
    try:
        return _fernet().decrypt(sealed.encode()).decode()
    except InvalidToken:
        return None


def exchange_code(code: str, redirect_uri: str) -> dict:
    s = get_settings()
    status, body = call(
        "POST",
        TOKEN_URL,
        data={
            "code": code,
            "client_id": s.google_client_id,
            "client_secret": s.google_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    if status != 200 or "refresh_token" not in body:
        raise GoogleError(status, body.get("error_description") or body.get("error") or "Google refused the sign-in")
    return body


def email_from_id_token(id_token: str) -> str:
    """The id_token came straight from Google's token endpoint over HTTPS; we only read the email."""
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("email", "")
    except (IndexError, ValueError):
        return ""


def _access_token(user_id: int, refresh_token: str) -> str:
    cached = _tokens.get(user_id)
    if cached and cached[1] > datetime.now(UTC) + timedelta(seconds=60):
        return cached[0]
    s = get_settings()
    status, body = call(
        "POST",
        TOKEN_URL,
        data={
            "refresh_token": refresh_token,
            "client_id": s.google_client_id,
            "client_secret": s.google_client_secret,
            "grant_type": "refresh_token",
        },
    )
    if status == 400 and body.get("error") == "invalid_grant":
        raise AccessRevoked(status, "Google access was removed")
    if status != 200:
        raise GoogleError(status, body.get("error_description") or "Couldn't refresh Google access")
    _tokens[user_id] = (body["access_token"], datetime.now(UTC) + timedelta(seconds=int(body.get("expires_in", 3600))))
    return body["access_token"]


def revoke(refresh_token: str) -> None:
    try:
        call("POST", REVOKE_URL, params={"token": refresh_token})
    except requests.RequestException:
        pass


# ---- what should be on Google ---------------------------------------------------------------


@dataclass
class WantedCalendar:
    course_id: int
    body: dict  # summary / description / timeZone
    color: str  # #RRGGBB


@dataclass
class Wanted:
    calendars: dict[int, WantedCalendar] = field(default_factory=dict)
    events: dict[str, tuple[int, dict]] = field(default_factory=dict)  # key -> (course id, event body)

    def digest(self) -> str:
        blob = json.dumps(
            {
                "c": {k: [v.body, v.color] for k, v in sorted(self.calendars.items())},
                "e": dict(sorted(self.events.items())),
            },
            sort_keys=True,
            default=str,
        )
        return _hash(blob)


def _hash(value) -> str:
    text = value if isinstance(value, str) else json.dumps(value, sort_keys=True, default=str)
    return hashlib.sha256(text.encode()).hexdigest()


def _zone(name: str) -> str:
    try:
        ZoneInfo(name)
        return name
    except (ZoneInfoNotFoundError, ValueError):
        return "Africa/Cairo"


def _first_on_or_after(start: date, weekday: int) -> date:
    return start + timedelta(days=(weekday - start.weekday()) % 7)


def _at(day: date, hhmm: str) -> str:
    h, m = map(int, hhmm.split(":"))
    return datetime.combine(day, time(h, m)).isoformat()


NO_REMINDERS = {"useDefault": False, "overrides": []}
UNTIMED_DUE_MINUTES = 9 * 60  # a deadline without a time counts as due at 09:00 (as in Gam3a's notifications)


def _popup(minutes: int) -> dict:
    """Google's own pop-up reminder, `minutes` before the event starts (Google allows up to 4 weeks)."""
    if minutes < 0:
        return NO_REMINDERS
    return {"useDefault": False, "overrides": [{"method": "popup", "minutes": min(minutes, 40320)}]}
KIND_NAMES = {"lecture": "Lecture", "lab": "Lab", "section": "Section", "tutorial": "Tutorial"}


def desired(db: Session, user: User, link: GoogleLink) -> Wanted:
    """Everything that should be on Google for this user right now."""
    from .routers.plan import build_plan  # late import: routers import this module

    tz = _zone(user.timezone)
    today = datetime.now(ZoneInfo(tz)).date()
    include_study = link.include_study
    class_lead = link.class_reminder if link.class_reminder is not None else 10
    deadline_lead = link.deadline_reminder if link.deadline_reminder is not None else 1440
    wanted = Wanted()
    terms = db.scalars(select(Term).where(Term.user_id == user.id, Term.end_date >= today)).all()
    for term in terms:
        until = f"RRULE:FREQ=WEEKLY;UNTIL={term.end_date:%Y%m%d}T235959Z"
        courses = {c.id: c for c in db.scalars(select(Course).where(Course.term_id == term.id))}
        for c in courses.values():
            name = f"{c.code} · {c.name}" if c.code else c.name
            wanted.calendars[c.id] = WantedCalendar(
                c.id, {"summary": name, "description": f"Gam3a · {term.name}", "timeZone": tz}, c.color.upper()
            )
        for m in db.scalars(select(Meeting).where(Meeting.course_id.in_(list(courses))).order_by(Meeting.id)):
            c = courses[m.course_id]
            day = _first_on_or_after(term.start_date, m.weekday)
            # Keyed by what the class is, not its row id: saving a course replaces its meeting
            # rows, and an unchanged class must not be deleted and made again on Google.
            key = f"m{c.id}-{m.weekday}-{m.start}-{m.end}-{m.kind}"
            while key in wanted.events:  # the same class listed twice
                key += "+"
            wanted.events[key] = (
                c.id,
                {
                    "summary": f"{c.code or c.name} · {KIND_NAMES.get(m.kind, m.kind)}",
                    "location": m.location,
                    "description": c.name,
                    "start": {"dateTime": _at(day, m.start), "timeZone": tz},
                    "end": {"dateTime": _at(day, m.end), "timeZone": tz},
                    "recurrence": [until],
                    "reminders": _popup(class_lead) if class_lead > 0 else NO_REMINDERS,
                },
            )
        if include_study:
            for b in build_plan(db, term, user).blocks:
                if b.kind != "study" or b.course_id not in courses:
                    continue
                c = courses[b.course_id]
                day = _first_on_or_after(term.start_date, b.weekday)
                key = f"s{term.id}-{b.course_id}-{b.weekday}-{b.start}"
                wanted.events[key] = (
                    c.id,
                    {
                        "summary": f"Study · {c.code or c.name}",
                        "description": c.name,
                        "start": {"dateTime": _at(day, b.start), "timeZone": tz},
                        "end": {"dateTime": _at(day, b.end), "timeZone": tz},
                        "recurrence": [until],
                        "transparency": "transparent",
                        "reminders": NO_REMINDERS,
                    },
                )
        items = db.scalars(
            select(Assessment).where(Assessment.course_id.in_(list(courses)), Assessment.due_date.is_not(None))
        )
        for a in items:
            c = courses[a.course_id]
            body = {
                "summary": f"{'✓ ' if a.done else ''}{a.title} · {c.code or c.name}",
                "description": f"{c.name} · {a.kind}",
                "transparency": "transparent",
                "reminders": NO_REMINDERS,
            }
            # Reminders count from the event's start, so aim them at the due time itself.
            lead = deadline_lead if deadline_lead > 0 and not a.done else -1
            if a.due_time:  # a half-hour block ending at the due time
                due = datetime.combine(a.due_date, time(*map(int, a.due_time.split(":"))))
                body["start"] = {"dateTime": (due - timedelta(minutes=30)).isoformat(), "timeZone": tz}
                body["end"] = {"dateTime": due.isoformat(), "timeZone": tz}
                body["reminders"] = _popup(max(0, lead - 30) if lead > 0 else -1)
            else:  # all-day: Google counts from midnight; the deadline itself is 09:00
                body["start"] = {"date": a.due_date.isoformat()}
                body["end"] = {"date": (a.due_date + timedelta(days=1)).isoformat()}
                body["reminders"] = _popup(max(0, lead - UNTIMED_DUE_MINUTES) if lead > 0 else -1)
            wanted.events[f"a{a.id}"] = (c.id, body)
    return wanted


# ---- syncing ----------------------------------------------------------------------------


def _text_on(color: str) -> str:
    """White or near-black text, whichever reads better on the course color."""
    r, g, b = (int(color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    light = 0.2126 * r**2.2 + 0.7152 * g**2.2 + 0.0722 * b**2.2
    return "#1B1B18" if light > 0.35 else "#FFFFFF"


def sync(db: Session, user: User, force: bool = False) -> bool:
    """Bring the user's Google calendars in line with Gam3a. Returns True if anything was sent."""
    link = db.get(GoogleLink, user.id)
    if link is None or not configured():
        return False
    lock = _locks.setdefault(user.id, threading.Lock())
    if not lock.acquire(blocking=False):
        return False  # another sync for this user is running
    try:
        wanted = desired(db, user, link)
        digest = wanted.digest()
        if digest == link.state_digest and not force:
            return False
        token = unseal(link.refresh_token)
        if token is None:
            link.last_error = RECONNECT
            db.commit()
            return False
        try:
            _apply(db, user.id, token, wanted, check_calendars=force)
        except AccessRevoked:
            link.last_error = REVOKED
            db.commit()
            return False
        except (GoogleError, requests.RequestException) as e:
            link.last_error = str(e)[:300]
            db.commit()
            log.warning("google sync for user %s failed: %s", user.id, e)
            return False
        link.state_digest = digest
        link.last_sync = datetime.now(UTC)
        link.last_error = ""
        db.commit()
        return True
    finally:
        lock.release()


def _apply(db: Session, user_id: int, token: str, wanted: Wanted, check_calendars: bool = False) -> None:
    """check_calendars: also confirm each calendar still exists (it may have been deleted in Google)."""
    api = lambda method, path, **kw: _api(user_id, token, method, path, **kw)  # noqa: E731

    # Calendars: one per course, named and colored like the course.
    have = {row.course_id: row for row in db.scalars(select(GoogleCalendar).where(GoogleCalendar.user_id == user_id))}
    for course_id, cal in wanted.calendars.items():
        row = have.get(course_id)
        digest = _hash([cal.body, cal.color])
        if row is not None and row.digest == digest and not check_calendars:
            continue
        if row is not None:
            status, _ = api("PATCH", f"/calendars/{row.calendar_id}", json_body=cal.body)
            if status in (404, 410):  # deleted on Google: make it again
                db.delete(row)
                db.flush()
                row = None
        if row is None:
            _, created = api("POST", "/calendars", json_body=cal.body)
            row = GoogleCalendar(user_id=user_id, course_id=course_id, calendar_id=created["id"])
            db.add(row)
            # Events belonged to the old calendar; they must be created again in the new one.
            for ev in db.scalars(
                select(GoogleEvent).where(GoogleEvent.user_id == user_id, GoogleEvent.course_id == course_id)
            ):
                db.delete(ev)
        api(
            "PATCH",
            f"/users/me/calendarList/{row.calendar_id}",
            params={"colorRgbFormat": "true"},
            json_body={"backgroundColor": cal.color, "foregroundColor": _text_on(cal.color)},
        )
        row.digest = digest
        db.commit()
    calendars = {row.course_id: row.calendar_id for row in db.scalars(
        select(GoogleCalendar).where(GoogleCalendar.user_id == user_id)
    )}

    # Events: create, update or delete by key.
    existing = {ev.key: ev for ev in db.scalars(select(GoogleEvent).where(GoogleEvent.user_id == user_id))}
    for key, (course_id, body) in wanted.events.items():
        calendar_id = calendars[course_id]
        digest = _hash(body)
        ev = existing.get(key)
        if ev is not None and ev.calendar_id != calendar_id:  # course's calendar was re-made
            api("DELETE", f"/calendars/{ev.calendar_id}/events/{ev.event_id}")
            db.delete(ev)
            ev = None
        if ev is not None and ev.digest == digest:
            continue
        if ev is not None:
            status, _ = api("PUT", f"/calendars/{calendar_id}/events/{ev.event_id}", json_body=body)
            if status not in (404, 410):
                ev.digest = digest
                db.commit()
                continue
            db.delete(ev)  # removed on Google: make it again
        status, created = api("POST", f"/calendars/{calendar_id}/events", json_body=body)
        if status in (404, 410):
            # The whole calendar was deleted in Google: make it again on the next run.
            for row in db.scalars(select(GoogleCalendar).where(GoogleCalendar.calendar_id == calendar_id)):
                row.digest = ""
            db.commit()
            raise GoogleError(status, "A course calendar was deleted in Google; it will be made again")
        db.add(GoogleEvent(
            user_id=user_id, key=key, course_id=course_id, calendar_id=calendar_id,
            event_id=created["id"], digest=digest,
        ))
        db.commit()
    for key, ev in existing.items():
        if key not in wanted.events and ev.course_id in wanted.calendars:
            api("DELETE", f"/calendars/{ev.calendar_id}/events/{ev.event_id}")
            db.delete(ev)
            db.commit()

    # Courses that are gone (deleted, or their term ended): remove their calendars.
    for course_id, row in have.items():
        if course_id not in wanted.calendars:
            api("DELETE", f"/calendars/{row.calendar_id}")
            for ev in db.scalars(
                select(GoogleEvent).where(GoogleEvent.user_id == user_id, GoogleEvent.course_id == course_id)
            ):
                db.delete(ev)
            db.delete(row)
            db.commit()


def disconnect(db: Session, user: User, remove_calendars: bool) -> None:
    """Forget the connection; optionally delete the calendars Gam3a made first."""
    link = db.get(GoogleLink, user.id)
    if link is None:
        return
    token = unseal(link.refresh_token)
    if token and remove_calendars:
        for row in db.scalars(select(GoogleCalendar).where(GoogleCalendar.user_id == user.id)):
            try:
                _api(user.id, token, "DELETE", f"/calendars/{row.calendar_id}")
            except (GoogleError, requests.RequestException):
                pass  # already gone, or access removed: nothing more we can do
    if token:
        revoke(token)
    for model in (GoogleEvent, GoogleCalendar):
        for row in db.scalars(select(model).where(model.user_id == user.id)):
            db.delete(row)
    db.delete(link)
    db.commit()
    _tokens.pop(user.id, None)


def sync_due(db: Session) -> None:
    """Called every minute by the background loop: sync whoever changed something.
    A failed sync is retried the next minute, unless Google access was removed."""
    if not configured():
        return
    for link in db.scalars(select(GoogleLink).where(GoogleLink.last_error.not_in([REVOKED, RECONNECT]))).all():
        user = db.get(User, link.user_id)
        if user is not None:
            sync(db, user)
