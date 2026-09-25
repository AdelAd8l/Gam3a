"""Request/response models."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
Weekday = Field(ge=0, le=6, description="0 = Monday … 6 = Sunday")
MeetingKind = Literal["lecture", "lab", "section", "tutorial"]
AssessmentKind = Literal["assignment", "quiz", "midterm", "final", "project", "other"]
Scale = Literal["4", "5"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _check_order(start: str, end: str) -> None:
    if end <= start:
        raise ValueError("End time must be after start time")


# ---- auth / user -------------------------------------------------------------


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    university: str = Field(default="", max_length=120)
    scale: Scale = "4"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORM):
    id: int
    email: str
    name: str
    university: str
    scale: Scale
    week_start: int


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    university: str | None = Field(default=None, max_length=120)
    scale: Scale | None = None
    week_start: int | None = Field(default=None, ge=0, le=6)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


# ---- terms ---------------------------------------------------------------------


class TermIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    start_date: date
    end_date: date
    study_start: str = Field(default="09:00", pattern=HHMM)
    study_end: str = Field(default="22:00", pattern=HHMM)
    hours_per_credit: float = Field(default=2.0, ge=0, le=6)
    session_minutes: int = Field(default=90, ge=30, le=240)
    rest_days: list[int] = Field(default_factory=lambda: [4])

    @field_validator("rest_days")
    @classmethod
    def valid_days(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("Rest days must be weekdays 0–6")
        return sorted(set(v))

    @model_validator(mode="after")
    def check(self):
        if self.end_date <= self.start_date:
            raise ValueError("The term must end after it starts")
        _check_order(self.study_start, self.study_end)
        return self


class TermOut(BaseModel):
    id: int
    name: str
    start_date: date
    end_date: date
    study_start: str
    study_end: str
    hours_per_credit: float
    session_minutes: int
    rest_days: list[int]


# ---- courses -------------------------------------------------------------------


class MeetingIn(BaseModel):
    weekday: int = Weekday
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    kind: MeetingKind = "lecture"
    location: str = Field(default="", max_length=60)

    @model_validator(mode="after")
    def check(self):
        _check_order(self.start, self.end)
        return self


class MeetingOut(ORM):
    id: int
    weekday: int
    start: str
    end: str
    kind: MeetingKind
    location: str


class CourseIn(BaseModel):
    term_id: int
    code: str = Field(default="", max_length=20)
    name: str = Field(min_length=1, max_length=100)
    credits: float = Field(default=3, ge=0, le=12)
    instructor: str = Field(default="", max_length=80)
    color: str = Field(default="#3E5C8A", pattern=r"^#[0-9A-Fa-f]{6}$")
    grade: str | None = Field(default=None, max_length=3)
    in_gpa: bool = True
    meetings: list[MeetingIn] = Field(default_factory=list, max_length=20)


class CourseOut(ORM):
    id: int
    term_id: int
    code: str
    name: str
    credits: float
    instructor: str
    color: str
    grade: str | None
    in_gpa: bool
    meetings: list[MeetingOut] = []
    # Weighted average of scored assessments, and how much of the course weight is scored.
    current_score: float | None = None
    graded_weight: float = 0


class GradeIn(BaseModel):
    grade: str | None = Field(default=None, max_length=3)


# ---- my timings ----------------------------------------------------------------


class BusyIn(BaseModel):
    term_id: int
    title: str = Field(min_length=1, max_length=60)
    weekday: int = Weekday
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)

    @model_validator(mode="after")
    def check(self):
        _check_order(self.start, self.end)
        return self


class BusyOut(ORM):
    id: int
    term_id: int
    title: str
    weekday: int
    start: str
    end: str


# ---- assessments ---------------------------------------------------------------


class AssessmentIn(BaseModel):
    course_id: int
    title: str = Field(min_length=1, max_length=100)
    kind: AssessmentKind = "assignment"
    due_date: date | None = None
    due_time: str | None = Field(default=None, pattern=HHMM)
    weight: float | None = Field(default=None, ge=0, le=100)
    score: float | None = Field(default=None, ge=0, le=150)
    done: bool = False


class AssessmentOut(ORM):
    id: int
    course_id: int
    title: str
    kind: AssessmentKind
    due_date: date | None
    due_time: str | None
    weight: float | None
    score: float | None
    done: bool


# ---- plan & grades -------------------------------------------------------------


class Block(BaseModel):
    kind: Literal["class", "busy", "study"]
    weekday: int
    start: str
    end: str
    course_id: int | None = None
    ref_id: int | None = None  # meeting / busy id
    title: str = ""
    detail: str = ""  # meeting kind or location


class Conflict(BaseModel):
    a: Block
    b: Block


class PlanOut(BaseModel):
    term_id: int
    blocks: list[Block]
    conflicts: list[Conflict]
    unplaced: dict[int, int]  # course_id -> study minutes that didn't fit
    study_minutes: int
    class_minutes: int


class TermGrades(BaseModel):
    term_id: int
    name: str
    start_date: date
    gpa: float | None
    gpa_credits: float
    earned_credits: float
    cgpa: float | None
    cumulative_credits: float
    cumulative_points: float
    in_progress: int  # courses without a final grade yet


class GradesOut(BaseModel):
    scale: Scale
    terms: list[TermGrades]
    cgpa: float | None
    total_credits: float
    earned_credits: float
    points: float
