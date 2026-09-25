"""Grade points and GPA maths."""

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
    gpa = round(points / credits, 3) if credits else None
    return TermResult(gpa=gpa, gpa_credits=credits, earned_credits=earned, points=points)


def required_gpa(current_points: float, current_credits: float, target: float, next_credits: float) -> float | None:
    """GPA needed over `next_credits` to bring the cumulative GPA to `target`."""
    if next_credits <= 0:
        return None
    return round((target * (current_credits + next_credits) - current_points) / next_credits, 3)
