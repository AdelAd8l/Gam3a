"""Grade points and GPA maths.

GPAs are cut (never rounded) to 3 decimals: many universities treat 3.499 as below 3.5,
so showing it as 3.50 would be wrong.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass

SCALES: dict[str, dict[str, float]] = {
    # Common 4.0 scale (Egypt, US and most of the region).
    "4": {
        "A+": 4.0, "A": 4.0, "A-": 3.7,
        "B+": 3.3, "B": 3.0, "B-": 2.7,
        "C+": 2.3, "C": 2.0, "C-": 1.7,
        "D+": 1.3, "D": 1.0, "F": 0.0,
    },
    # 5.0 scale used by Saudi and other Gulf universities.
    "5": {
        "A+": 5.0, "A": 4.75,
        "B+": 4.5, "B": 4.0,
        "C+": 3.5, "C": 3.0,
        "D+": 2.5, "D": 2.0, "F": 1.0,
    },
}

# Recorded on the transcript but never part of the GPA.
NON_GPA_GRADES = {"P", "W", "I"}
FAILING = {"F"}


def truncate_gpa(value: float, places: int = 3) -> float:
    """3.49966 → 3.499. The tiny epsilon absorbs float noise (3.49 is stored as 3.48999…)."""
    factor = 10**places
    return math.floor(value * factor + 1e-9) / factor


def ceil_gpa(value: float, places: int = 3) -> float:
    """For "you need at least X": round up so the target is never missed by a hair."""
    factor = 10**places
    return math.ceil(value * factor - 1e-9) / factor


@dataclass
class GradedCourse:
    credits: float
    grade: str | None
    in_gpa: bool = True


@dataclass
class TermResult:
    gpa: float | None
    gpa_credits: float  # credits that counted towards the GPA
    earned_credits: float  # credits passed (including pass/fail courses)
    points: float


def is_valid_grade(grade: str, scale: str) -> bool:
    return grade in SCALES[scale] or grade in NON_GPA_GRADES


def term_result(courses: Iterable[GradedCourse], scale: str) -> TermResult:
    table = SCALES[scale]
    points = credits = earned = 0.0
    for c in courses:
        if not c.grade:
            continue  # still in progress
        if c.grade not in FAILING and c.grade not in ("W", "I"):
            earned += c.credits
        if c.in_gpa and c.grade in table:
            points += table[c.grade] * c.credits
            credits += c.credits
    gpa = truncate_gpa(points / credits) if credits else None
    return TermResult(gpa=gpa, gpa_credits=credits, earned_credits=earned, points=points)


def required_gpa(current_points: float, current_credits: float, target: float, next_credits: float) -> float | None:
    """GPA needed over `next_credits` to bring the cumulative GPA to `target`."""
    if next_credits <= 0:
        return None
    return ceil_gpa((target * (current_credits + next_credits) - current_points) / next_credits)


# ---- course percentages → letters -------------------------------------------------

# Minimum course percentage for each letter. The 4.0 defaults follow the common
# A+ ≥ 97, A ≥ 93, A- ≥ 90 … ladder; every user can override them in Settings.
DEFAULT_CUTOFFS: dict[str, dict[str, float]] = {
    "4": {
        "A+": 97, "A": 93, "A-": 90,
        "B+": 87, "B": 83, "B-": 80,
        "C+": 77, "C": 73, "C-": 70,
        "D+": 67, "D": 60, "F": 0,
    },
    "5": {
        "A+": 95, "A": 90, "B+": 85, "B": 80,
        "C+": 75, "C": 70, "D+": 65, "D": 60, "F": 0,
    },
}


def cutoffs_for(scale: str, custom: dict[str, float] | None) -> dict[str, float]:
    """The user's cut-offs for their scale, falling back to the defaults letter by letter."""
    base = dict(DEFAULT_CUTOFFS[scale])
    for letter, value in (custom or {}).items():
        if letter in base and letter != "F":
            base[letter] = float(value)
    return base


def letter_for(percent: float, cutoffs: dict[str, float]) -> str:
    for letter, minimum in sorted(cutoffs.items(), key=lambda kv: -kv[1]):
        if percent >= minimum - 1e-9:
            return letter
    return "F"


@dataclass
class Graded:
    weight: float | None  # % of the course grade
    score: float | None  # % achieved on this item


@dataclass
class CourseProgress:
    graded_weight: float  # how much of the course has been marked
    listed_weight: float  # how much of the course the student has entered so far
    earned: float  # course points secured (out of 100)
    remaining_weight: float  # 100 − graded_weight (includes coursework not entered yet)
    current: float | None  # average on what's been marked
    max_possible: float  # earned + everything still to come
    required: float | None  # average needed on the remaining weight to hit the target
    status: str  # "secured" | "on_track" | "needs" | "out_of_reach" | "no_data"


def course_progress(items: Iterable[Graded], target: float) -> CourseProgress:
    graded_weight = earned = listed = 0.0
    for item in items:
        if not item.weight:
            continue
        listed += item.weight
        if item.score is not None:
            graded_weight += item.weight
            earned += item.weight * item.score / 100
    remaining = max(0.0, 100 - graded_weight)
    current = earned / graded_weight * 100 if graded_weight else None
    required = (target - earned) / remaining * 100 if remaining > 1e-9 else None
    max_possible = earned + remaining

    if earned >= target - 1e-9:
        status = "secured"
    elif max_possible < target - 1e-9:
        status = "out_of_reach"
    elif current is None:
        status = "no_data"
    elif required is not None and current >= required - 1e-9:
        status = "on_track"
    else:
        status = "needs"
    return CourseProgress(
        graded_weight=round(graded_weight, 2),
        listed_weight=round(listed, 2),
        earned=round(earned, 2),
        remaining_weight=round(remaining, 2),
        current=round(current, 2) if current is not None else None,
        max_possible=round(max_possible, 2),
        required=round(max(required, 0), 2) if required is not None else None,
        status=status,
    )


def parse_cutoffs(raw: str) -> dict[str, float]:
    import json

    try:
        data = json.loads(raw) if raw else {}
        return {str(k): float(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}


def user_cutoffs(user) -> dict[str, float]:
    return cutoffs_for(user.scale, parse_cutoffs(user.cutoffs))
