"""Lecture and deadline reminders, delivered as Web Push notifications.

Every minute `run_once` looks at each user who has a subscribed device and works out, in the
user's own time zone, which classes and deadlines are coming up within their reminder window.
Each reminder is recorded in `sent_notices` *before* it is sent, under a unique key, so it goes
out exactly once even if the check runs twice or on several workers at the same time.

Deadlines without a time are treated as due at 09:00, so a "1 day before" reminder arrives at
09:00 the day before rather than at midnight.
"""

import asyncio
import base64
import json
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .database import SessionLocal
from .models import AppKey, Assessment, Course, Meeting, PushSubscription, SentNotice, Term, User

log = logging.getLogger("gam3a.notify")

UNTIMED_DUE = time(9, 0)
KEEP_SENT = timedelta(days=45)

# ---- VAPID keys ------------------------------------------------------------------------


def _vapid(db: Session) -> Vapid02:
    pem = get_settings().vapid_private_key.strip()
    if not pem:
        row = db.get(AppKey, "vapid_private")
        if row is None:
            key = Vapid02()
            key.generate_keys()
            pem = key.private_pem().decode()
            db.add(AppKey(name="vapid_private", value=pem))
            try:
                db.commit()
            except IntegrityError:  # another worker won the race: use its key
                db.rollback()
                pem = db.get(AppKey, "vapid_private").value
        else:
            pem = row.value
    return Vapid02.from_pem(pem.encode())


def public_key(db: Session) -> str:
    """The application server key browsers need to subscribe (URL-safe base64, no padding)."""
    raw = _vapid(db).public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# ---- texts -----------------------------------------------------------------------------

KINDS = {
    "en": {
        "lecture": "Lecture",
        "lab": "Lab",
        "section": "Section",
        "tutorial": "Tutorial",
        "assignment": "Assignment",
        "quiz": "Quiz",
        "midterm": "Midterm",
        "final": "Final",
        "project": "Project",
        "other": "Deadline",
    },
    "ar": {
        "lecture": "محاضرة",
        "lab": "معمل",
        "section": "سكشن",
        "tutorial": "تمارين",
        "assignment": "تكليف",
        "quiz": "كويز",
        "midterm": "ميدترم",
        "final": "فاينال",
        "project": "مشروع",
        "other": "موعد",
    },
}


def _in(minutes: int, lang: str) -> str:
    """'in 15 min', 'in 2 h', 'tomorrow' … in the user's language."""
    if minutes < 1:
        return "now" if lang == "en" else "الآن"
    if minutes < 60:
        return f"in {minutes} min" if lang == "en" else f"بعد {minutes} دقيقة"
    hours = round(minutes / 60)
    if hours < 24:
        return f"in {hours} h" if lang == "en" else f"بعد {hours} ساعة"
    days = round(minutes / 1440)
    if days == 1:
        return "tomorrow" if lang == "en" else "غدًا"
    return f"in {days} days" if lang == "en" else f"بعد {days} أيام"


def class_message(course: Course, meeting: Meeting, minutes: int, lang: str) -> dict:
    kind = KINDS[lang].get(meeting.kind, meeting.kind)
    name = course.code or course.name
    title = f"{name} · {kind} {_in(minutes, lang)}" if lang == "en" else f"{kind} {name} {_in(minutes, lang)}"
    body = " · ".join(x for x in (f"{meeting.start}–{meeting.end}", meeting.location, course.name if course.code else "") if x)
    return {"title": title, "body": body, "url": "/", "tag": f"class-{meeting.id}"}


def deadline_message(course: Course, item: Assessment, minutes: int, lang: str) -> dict:
    kind = KINDS[lang].get(item.kind, item.kind)
    when = _in(minutes, lang)
    title = f"{item.title} is due {when}" if lang == "en" else f"موعد {item.title} {when}"
    at = item.due_time or ""
    body = " · ".join(x for x in (course.code or course.name, kind, at) if x)
    return {"title": title, "body": body, "url": "/deadlines", "tag": f"due-{item.id}"}


# ---- what is due -----------------------------------------------------------------------


@dataclass
class Notice:
    user_id: int
    key: str
    payload: dict
    # How long the push service keeps it for a phone that's offline. Past this it's dropped:
    # a reminder for a class that already started is no use.
    ttl: int = 3600


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("Africa/Cairo")


def _at(day: date, hhmm: str, tz: ZoneInfo) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime.combine(day, time(h, m), tzinfo=tz)


def due_notices(db: Session, user: User, now: datetime) -> list[Notice]:
    """Reminders whose time has come for one user (not yet de-duplicated)."""
    tz = _zone(user.timezone)
    local = now.astimezone(tz)
    today = local.date()
    lang = user.lang if user.lang in KINDS else "en"
    out: list[Notice] = []

    if user.notify_classes:
        lead = timedelta(minutes=user.class_lead)
        # Look at today and tomorrow so early-morning reminders set the night before work.
        for day in (today, today + timedelta(days=1)):
            rows = db.execute(
                select(Meeting, Course)
                .join(Course, Meeting.course_id == Course.id)
                .join(Term, Course.term_id == Term.id)
                .where(
                    Meeting.user_id == user.id,
                    Meeting.weekday == day.weekday(),
                    Term.start_date <= day,
                    Term.end_date >= day,
                )
            ).all()
            for meeting, course in rows:
                starts = _at(day, meeting.start, tz)
                if starts - lead <= local < starts:
                    minutes = round((starts - local).total_seconds() / 60)
                    message = class_message(course, meeting, minutes, lang)
                    until = int((starts - local).total_seconds())
                    out.append(Notice(user.id, f"m{meeting.id}:{day.isoformat()}", message, ttl=max(60, until)))

    if user.notify_deadlines:
        lead = timedelta(minutes=user.deadline_lead)
        horizon = today + timedelta(days=user.deadline_lead // 1440 + 2)
        rows = db.execute(
            select(Assessment, Course)
            .join(Course, Assessment.course_id == Course.id)
            .where(
                Assessment.user_id == user.id,
                Assessment.done.is_(False),
                Assessment.due_date.is_not(None),
                Assessment.due_date >= today,
                Assessment.due_date <= horizon,
            )
        ).all()
        for item, course in rows:
            due = _at(item.due_date, item.due_time, tz) if item.due_time else datetime.combine(item.due_date, UNTIMED_DUE, tzinfo=tz)
            if due - lead <= local < due:
                minutes = round((due - local).total_seconds() / 60)
                # The key includes the due date/time, so moving a deadline earns a new reminder.
                key = f"a{item.id}:{item.due_date.isoformat()}{item.due_time or ''}"
                until = int((due - local).total_seconds())
                message = deadline_message(course, item, minutes, lang)
                out.append(Notice(user.id, key, message, ttl=max(60, min(until, 2 * 86400))))
    return out


# ---- sending ---------------------------------------------------------------------------


def send_to_user(
    db: Session, user_id: int, payload: dict, vapid: Vapid02 | None = None, ttl: int = 3600
) -> int:
    """Push one message to every device of a user. Returns how many accepted it."""
    vapid = vapid or _vapid(db)
    subject = get_settings().vapid_subject
    sent = 0
    for sub in db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id)).all():
        try:
            webpush(
                {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                json.dumps(payload),
                vapid_private_key=vapid,
                vapid_claims={"sub": subject},
                ttl=ttl,
                timeout=10,
            )
            sent += 1
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):  # the device unsubscribed or the app was removed
                db.delete(sub)
                db.commit()
            else:
                log.warning("push to user %s failed: %s", user_id, e)
        except Exception as e:  # network trouble: try the next device
            log.warning("push to user %s failed: %s", user_id, e)
    return sent


def run_once(db: Session, now: datetime | None = None) -> int:
    """Send every reminder that is due. Returns the number of notices recorded."""
    now = now or datetime.now(UTC)
    user_ids = db.scalars(select(PushSubscription.user_id).distinct()).all()
    if not user_ids:
        return 0
    vapid = _vapid(db)
    count = 0
    for user in db.scalars(select(User).where(User.id.in_(user_ids))).all():
        for notice in due_notices(db, user, now):
            db.add(SentNotice(user_id=notice.user_id, key=notice.key))
            try:
                db.commit()  # claim it first: only one run gets to send it
            except IntegrityError:
                db.rollback()
                continue
            send_to_user(db, notice.user_id, notice.payload, vapid, notice.ttl)
            count += 1
    db.execute(delete(SentNotice).where(SentNotice.sent_at < now - KEEP_SENT))
    db.commit()
    return count


def _tick() -> None:
    with SessionLocal() as db:
        run_once(db)


async def loop() -> None:
    """Background task started with the app: check once a minute, forever."""
    while True:
        try:
            await asyncio.to_thread(_tick)
        except Exception:
            log.exception("reminder check failed")
        await asyncio.sleep(60 - datetime.now().second)
