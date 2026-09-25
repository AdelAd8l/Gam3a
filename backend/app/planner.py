"""Weekly study-plan generator.

Given a term's classes, the student's own commitments and their study preferences, place
study sessions for every course into the free time of the week.

The approach is deliberately simple and deterministic, so the same inputs always give
the same timetable:

1. Each day's free time = the study window minus classes and commitments
   (plus a short buffer after each one so sessions don't start the minute a class ends).
2. Each course needs ``credits × hours_per_credit`` hours a week, split into sessions
   (the last one shorter if needed).
3. Sessions are dealt out round-robin (biggest courses first) so no course is starved,
   and each goes to the least-loaded day that doesn't already have that course,
   in the earliest gap long enough to hold it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

BUFFER = 15  # minutes kept free after a class or commitment
GAP = 15  # minutes between two study sessions
MIN_SESSION = 30


def to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def to_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


@dataclass(frozen=True)
class Slot:
    weekday: int
    start: int
    end: int


@dataclass
class CourseNeed:
    course_id: int
    credits: float


@dataclass
class Placed:
    course_id: int
    weekday: int
    start: int
    end: int


@dataclass
class PlanResult:
    sessions: list[Placed] = field(default_factory=list)
    unplaced_minutes: dict[int, int] = field(default_factory=dict)


def subtract(free: list[tuple[int, int]], block: tuple[int, int]) -> list[tuple[int, int]]:
    """Remove [start, end) from a sorted list of free intervals."""
    s, e = block
    out = []
    for fs, fe in free:
        if e <= fs or s >= fe:
            out.append((fs, fe))
            continue
        if fs < s:
            out.append((fs, s))
        if e < fe:
            out.append((e, fe))
    return out


def free_time(
    window: tuple[int, int], taken: list[Slot], rest_days: set[int]
) -> dict[int, list[tuple[int, int]]]:
    free: dict[int, list[tuple[int, int]]] = {}
    for day in range(7):
        if day in rest_days:
            free[day] = []
            continue
        intervals = [window]
        for slot in taken:
            if slot.weekday == day:
                intervals = subtract(intervals, (slot.start, slot.end + BUFFER))
        free[day] = intervals
    return free


def plan_week(
    needs: list[CourseNeed],
    taken: list[Slot],
    window: tuple[int, int],
    rest_days: set[int],
    hours_per_credit: float,
    session_minutes: int,
    week_order: list[int] | None = None,
) -> PlanResult:
    session_minutes = max(MIN_SESSION, session_minutes)
    free = free_time(window, taken, rest_days)
    order = week_order or list(range(7))
    result = PlanResult()

    # Split each course's weekly minutes into sessions; the last one takes the remainder
    # (rounded up to MIN_SESSION) so the total matches the credit hours.
    lengths: dict[int, list[int]] = {}
    for need in needs:
        minutes = round(need.credits * hours_per_credit * 60)
        full, rest = divmod(minutes, session_minutes)
        chunks = [session_minutes] * full
        if rest:
            chunks.append(max(MIN_SESSION, math.ceil(rest / 15) * 15))
        lengths[need.course_id] = chunks

    # Round-robin, biggest courses first, so everyone gets a fair share of the good slots.
    queue: list[tuple[int, int]] = []
    by_size = sorted(needs, key=lambda n: (-n.credits, n.course_id))
    while any(lengths[n.course_id] for n in by_size):
        for n in by_size:
            if lengths[n.course_id]:
                queue.append((n.course_id, lengths[n.course_id].pop(0)))

    load = {d: 0 for d in range(7)}
    days_with: dict[int, set[int]] = {n.course_id: set() for n in needs}

    for course_id, length in queue:
        candidates = sorted(
            (d for d in order if free[d]),
            key=lambda d: (d in days_with[course_id], load[d], order.index(d)),
        )
        placed = False
        for day in candidates:
            for fs, fe in free[day]:
                if fe - fs >= length:
                    start, end = fs, fs + length
                    result.sessions.append(Placed(course_id, day, start, end))
                    free[day] = subtract(free[day], (start, end + GAP))
                    load[day] += length
                    days_with[course_id].add(day)
                    placed = True
                    break
            if placed:
                break
        if not placed:
            result.unplaced_minutes[course_id] = result.unplaced_minutes.get(course_id, 0) + length

    result.sessions.sort(key=lambda p: (order.index(p.weekday), p.start))
    return result


def find_conflicts(slots: list[tuple[str, int, Slot]]) -> list[tuple[str, int, str, int]]:
    """Pairs of (kind, id) whose times overlap on the same weekday."""
    conflicts = []
    for i, (kind_a, id_a, a) in enumerate(slots):
        for kind_b, id_b, b in slots[i + 1 :]:
            if a.weekday == b.weekday and a.start < b.end and b.start < a.end:
                conflicts.append((kind_a, id_a, kind_b, id_b))
    return conflicts
