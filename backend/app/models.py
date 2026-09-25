"""Database models.

Times of day are stored as "HH:MM" strings and weekdays as 0=Monday … 6=Sunday
(Python's date.weekday()), so the schedule logic never has to deal with time zones.
"""

from datetime import UTC, date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def _now() -> datetime:
    return datetime.now(UTC)


def _user_fk():
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(255))
    university: Mapped[str] = mapped_column(String(120), default="")
    # GPA scale: "4" (A+/A = 4.0) or "5" (A+ = 5.0, used across the Gulf).
    scale: Mapped[str] = mapped_column(String(2), default="4")
    # First day of the week in timetables (5 = Saturday, common in Egypt).
    week_start: Mapped[int] = mapped_column(Integer, default=5)
    # Minimum percentage for each letter, as JSON: {"A+": 97, "A": 93, ...}. Empty = defaults.
    cutoffs: Mapped[str] = mapped_column(String(400), default="")
    # The grade new courses aim for.
    default_target: Mapped[str] = mapped_column(String(3), default="A")
    # Usual length of one class, used to fill in end times (1 h 40 min by default).
    class_minutes: Mapped[int] = mapped_column(Integer, default=100)
    # Grade points per letter and GPA needed per classification, as JSON. Empty = defaults.
    points: Mapped[str] = mapped_column(String(400), default="")
    bands: Mapped[str] = mapped_column(String(200), default="")
    # Notifications: sent in the user's time zone and language, some minutes before each event.
    timezone: Mapped[str] = mapped_column(String(64), default="Africa/Cairo")
    # True: follow the phone that receives the notifications (updated when you travel).
    # False: the zone was picked by hand in Settings and stays put.
    timezone_auto: Mapped[bool] = mapped_column(Boolean, default=True)
    lang: Mapped[str] = mapped_column(String(2), default="en")
    notify_classes: Mapped[bool] = mapped_column(Boolean, default=True)
    class_lead: Mapped[int] = mapped_column(Integer, default=15)  # minutes before a class
    notify_deadlines: Mapped[bool] = mapped_column(Boolean, default=True)
    deadline_lead: Mapped[int] = mapped_column(Integer, default=1440)  # minutes before a deadline
    # Admin: can see, edit and delete every account (Settings -> Admin).
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set for the first admin sign-in and after an admin resets a password.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # Bumped when the password changes, so sessions signed with the old one stop working.
    session_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Term(Base):
    __tablename__ = "terms"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    name: Mapped[str] = mapped_column(String(60))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    # Study-planner preferences for this term.
    study_start: Mapped[str] = mapped_column(String(5), default="09:00")
    study_end: Mapped[str] = mapped_column(String(5), default="22:00")
    hours_per_credit: Mapped[float] = mapped_column(Float, default=2.0)
    session_minutes: Mapped[int] = mapped_column(Integer, default=90)
    rest_days: Mapped[str] = mapped_column(String(20), default="4")  # comma-separated weekdays; 4 = Friday


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    term_id: Mapped[int] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20), default="")
    name: Mapped[str] = mapped_column(String(100))
    credits: Mapped[float] = mapped_column(Float, default=3)
    instructor: Mapped[str] = mapped_column(String(80), default="")
    color: Mapped[str] = mapped_column(String(7), default="#3E5C8A")
    grade: Mapped[str | None] = mapped_column(String(3), nullable=True)
    in_gpa: Mapped[bool] = mapped_column(Boolean, default=True)
    target_grade: Mapped[str | None] = mapped_column(String(3), nullable=True)  # None = user's default


class Meeting(Base):
    """A weekly class: lecture, lab, section or tutorial."""

    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    weekday: Mapped[int] = mapped_column(Integer)
    start: Mapped[str] = mapped_column(String(5))
    end: Mapped[str] = mapped_column(String(5))
    kind: Mapped[str] = mapped_column(String(12), default="lecture")
    location: Mapped[str] = mapped_column(String(60), default="")


class Busy(Base):
    """A personal weekly commitment the study planner must work around (job, gym, commute…)."""

    __tablename__ = "busy"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    term_id: Mapped[int] = mapped_column(ForeignKey("terms.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(60))
    weekday: Mapped[int] = mapped_column(Integer)
    start: Mapped[str] = mapped_column(String(5))
    end: Mapped[str] = mapped_column(String(5))


class Assessment(Base):
    """Anything graded or due: assignment, quiz, midterm, final, project."""

    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(12), default="assignment")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    due_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    weight: Mapped[float | None] = mapped_column(Float, nullable=True)  # % of the course grade
    score: Mapped[float | None] = mapped_column(Float, nullable=True)  # % achieved
    # Raw marks as written on the paper, e.g. 28 / 30. When both are set, score = earned / max.
    points_earned: Mapped[float | None] = mapped_column(Float, nullable=True)
    points_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)


class PushSubscription(Base):
    """One browser/phone that agreed to receive notifications (Web Push)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SentNotice(Base):
    """Remembers which reminders went out, so each is sent once (even with several workers)."""

    __tablename__ = "sent_notices"
    __table_args__ = (UniqueConstraint("user_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    key: Mapped[str] = mapped_column(String(80))
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class AppKey(Base):
    """Server-wide secrets generated on first use (the VAPID key pair for Web Push)."""

    __tablename__ = "app_keys"

    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class GoogleLink(Base):
    """A user's connected Google Calendar (one per user)."""

    __tablename__ = "google_links"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), default="")
    refresh_token: Mapped[str] = mapped_column(Text)  # encrypted with the server's secret key
    include_study: Mapped[bool] = mapped_column(Boolean, default=True)
    state_digest: Mapped[str] = mapped_column(String(64), default="")  # what was last sent
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GoogleCalendar(Base):
    """The Google calendar made for one course. course_id is not a foreign key on purpose:
    when a course is deleted we still need this row to delete its calendar on Google."""

    __tablename__ = "google_calendars"
    __table_args__ = (UniqueConstraint("user_id", "course_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    course_id: Mapped[int] = mapped_column(Integer)
    calendar_id: Mapped[str] = mapped_column(String(300))
    digest: Mapped[str] = mapped_column(String(64), default="")  # name + color last sent


class GoogleEvent(Base):
    """One event Gam3a put on Google, by a stable key such as "a7" (assessment 7) or a class key."""

    __tablename__ = "google_events"
    __table_args__ = (UniqueConstraint("user_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    key: Mapped[str] = mapped_column(String(80))
    course_id: Mapped[int] = mapped_column(Integer)
    calendar_id: Mapped[str] = mapped_column(String(300))
    event_id: Mapped[str] = mapped_column(String(300))
    digest: Mapped[str] = mapped_column(String(64), default="")


def delete_user(db, user: User) -> None:
    """Remove a user; every table cascades from users.id at the database level."""
    from sqlalchemy import delete

    db.execute(delete(User).where(User.id == user.id))
    db.commit()
