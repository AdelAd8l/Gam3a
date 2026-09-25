from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..grading import GradedCourse, classify, term_result, truncate_gpa, user_bands, user_points
from ..models import Course, Term, User
from ..schemas import GradesOut, TermGrades
from ..security import current_user

router = APIRouter(prefix="/api/grades", tags=["grades"])


@router.get("", response_model=GradesOut)
def grades(user: User = Depends(current_user), db: Session = Depends(get_db)):
    terms = list(db.scalars(select(Term).where(Term.user_id == user.id).order_by(Term.start_date, Term.id)))
    courses = list(db.scalars(select(Course).where(Course.user_id == user.id)))

    table = user_points(user)
    bands = user_bands(user)
    rows = []
    points = credits = earned = 0.0
    for term in terms:
        mine = [c for c in courses if c.term_id == term.id]
        r = term_result((GradedCourse(c.credits, c.grade, c.in_gpa) for c in mine), table)
        cgpa_before = truncate_gpa(points / credits) if credits else None
        points += r.points
        credits += r.gpa_credits
        earned += r.earned_credits
        cgpa = truncate_gpa(points / credits) if credits else None
        rows.append(
            TermGrades(
                term_id=term.id,
                name=term.name,
                start_date=term.start_date,
                gpa=r.gpa,
                gpa_credits=r.gpa_credits,
                cgpa_before=cgpa_before,
                earned_credits=r.earned_credits,
                cgpa=cgpa,
                gpa_class=classify(r.gpa, bands),
                cgpa_class=classify(cgpa, bands) if r.gpa is not None else None,
                cumulative_credits=credits,
                cumulative_points=round(points, 6),
                in_progress=sum(1 for c in mine if not c.grade),
            )
        )
    return GradesOut(
        scale=user.scale,
        terms=rows,
        cgpa=truncate_gpa(points / credits) if credits else None,
        cgpa_class=classify(truncate_gpa(points / credits), bands) if credits else None,
        total_credits=credits,
        earned_credits=earned,
        points=round(points, 6),
    )
