"""Database models.

Times of day are stored as "HH:MM" strings and weekdays as 0=Monday … 6=Sunday
(Python's date.weekday()), so the schedule logic never has to deal with time zones.
"""

from datetime import UTC, date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String
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


def delete_user(db, user: User) -> None:
    """Remove a user; every table cascades from users.id at the database level."""
    from sqlalchemy import delete

    db.execute(delete(User).where(User.id == user.id))
    db.commit()
