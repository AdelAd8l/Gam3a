from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Assessment, Busy, Course, Meeting, Term, User
from ..planner import CourseNeed, Slot, find_conflicts, plan_week, to_hhmm, to_minutes
from ..schemas import Block, Conflict, PlanOut
from ..security import current_user
from .deps import get_owned
from .terms import to_out

router = APIRouter(prefix="/api/terms", tags=["schedule"])


def week_order(user: User) -> list[int]:
    return [(user.week_start + i) % 7 for i in range(7)]


def build_plan(db: Session, term: Term, user: User) -> PlanOut:
    courses = {c.id: c for c in db.scalars(select(Course).where(Course.term_id == term.id))}
    meetings = list(db.scalars(select(Meeting).where(Meeting.course_id.in_(list(courses)))))
    busy = list(db.scalars(select(Busy).where(Busy.term_id == term.id)))
    prefs = to_out(term)

    blocks: list[Block] = []
    tagged: list[tuple[str, int, Slot]] = []
    for m in meetings:
        c = courses[m.course_id]
        blocks.append(
            Block(kind="class", weekday=m.weekday, start=m.start, end=m.end, course_id=c.id, ref_id=m.id,
                  title=c.code or c.name, detail=m.kind if not m.location else f"{m.kind} · {m.location}")
        )
        tagged.append(("class", len(blocks) - 1, Slot(m.weekday, to_minutes(m.start), to_minutes(m.end))))
    for b in busy:
        blocks.append(Block(kind="busy", weekday=b.weekday, start=b.start, end=b.end, ref_id=b.id, title=b.title))
        tagged.append(("busy", len(blocks) - 1, Slot(b.weekday, to_minutes(b.start), to_minutes(b.end))))

    result = plan_week(
        needs=[CourseNeed(c.id, c.credits) for c in courses.values() if c.grade is None],
        taken=[slot for _, _, slot in tagged],
        window=(to_minutes(prefs.study_start), to_minutes(prefs.study_end)),
        rest_days=set(prefs.rest_days),
        hours_per_credit=term.hours_per_credit,
        session_minutes=term.session_minutes,
        week_order=week_order(user),
    )
    for s in result.sessions:
        c = courses[s.course_id]
        blocks.append(Block(kind="study", weekday=s.weekday, start=to_hhmm(s.start), end=to_hhmm(s.end),
                            course_id=c.id, title=c.code or c.name))

    order = week_order(user)
    blocks.sort(key=lambda b: (order.index(b.weekday), b.start))
    conflicts = [Conflict(a=blocks[i], b=blocks[j]) for _, i, _, j in find_conflicts(tagged)]
    minutes = lambda kind: sum(to_minutes(b.end) - to_minutes(b.start) for b in blocks if b.kind == kind)  # noqa: E731
    return PlanOut(
        term_id=term.id,
        blocks=blocks,
        conflicts=conflicts,
        unplaced=result.unplaced_minutes,
        study_minutes=minutes("study"),
        class_minutes=minutes("class"),
    )


@router.get("/{term_id}/plan", response_model=PlanOut)
def get_plan(term_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return build_plan(db, get_owned(db, Term, term_id, user), user)


# ---- calendar export -------------------------------------------------------------


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\;").replace(",", "\\,").replace("\n", "\\n")


def _first_on_or_after(start: date, weekday: int) -> date:
    return start + timedelta(days=(weekday - start.weekday()) % 7)


@router.get("/{term_id}/calendar.ics")
def calendar(term_id: int, study: bool = True, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Classes (and optionally study sessions) as weekly events until the term ends, plus dated deadlines."""
    term = get_owned(db, Term, term_id, user)
    plan = build_plan(db, term, user)
    courses = {c.id: c for c in db.scalars(select(Course).where(Course.term_id == term.id))}
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    until = term.end_date.strftime("%Y%m%dT235959Z")

    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gam3a//Planner//EN", "CALSCALE:GREGORIAN",
             f"X-WR-CALNAME:{_esc(term.name)}"]
    for i, b in enumerate(plan.blocks):
        if b.kind == "busy" or (b.kind == "study" and not study):
            continue
        day = _first_on_or_after(term.start_date, b.weekday).strftime("%Y%m%d")
        course = courses.get(b.course_id)
        name = course.name if course else b.title
        summary = f"{name} ({b.detail.split(' · ')[0]})" if b.kind == "class" else f"Study: {name}"
        lines += [
            "BEGIN:VEVENT",
            f"UID:gam3a-{term.id}-{b.kind}-{i}@gam3a",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{day}T{b.start.replace(':', '')}00",
            f"DTEND:{day}T{b.end.replace(':', '')}00",
            f"RRULE:FREQ=WEEKLY;UNTIL={until}",
            f"SUMMARY:{_esc(summary)}",
        ]
        if b.kind == "class" and " · " in b.detail:
            lines.append(f"LOCATION:{_esc(b.detail.split(' · ', 1)[1])}")
        lines.append("END:VEVENT")

    items = db.scalars(
        select(Assessment).where(Assessment.course_id.in_(list(courses)), Assessment.due_date.is_not(None))
    )
    for a in items:
        course = courses[a.course_id]
        lines += ["BEGIN:VEVENT", f"UID:gam3a-assessment-{a.id}@gam3a", f"DTSTAMP:{stamp}"]
        if a.due_time:
            lines.append(f"DTSTART:{a.due_date:%Y%m%d}T{a.due_time.replace(':', '')}00")
        else:
            lines += [f"DTSTART;VALUE=DATE:{a.due_date:%Y%m%d}",
                      f"DTEND;VALUE=DATE:{a.due_date + timedelta(days=1):%Y%m%d}"]
        lines += [f"SUMMARY:{_esc(f'{a.title} — {course.code or course.name}')}", "END:VEVENT"]

    lines.append("END:VCALENDAR")
    filename = "".join(ch if ch.isalnum() else "-" for ch in term.name).strip("-") or "term"
    return Response(
        "\r\n".join(lines) + "\r\n",
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{filename}.ics"'},
    )
