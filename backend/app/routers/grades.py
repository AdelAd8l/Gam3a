from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..grading import GradedCourse, term_result
from ..models import Course, Term, User
from ..schemas import GradesOut, TermGrades
from ..security import current_user

router = APIRouter(prefix="/api/grades", tags=["grades"])


@router.get("", response_model=GradesOut)
def grades(user: User = Depends(current_user), db: Session = Depends(get_db)):
    terms = list(db.scalars(select(Term).where(Term.user_id == user.id).order_by(Term.start_date, Term.id)))
    courses = list(db.scalars(select(Course).where(Course.user_id == user.id)))

    rows = []
    points = credits = earned = 0.0
    for term in terms:
        mine = [c for c in courses if c.term_id == term.id]
        r = term_result((GradedCourse(c.credits, c.grade, c.in_gpa) for c in mine), user.scale)
        points += r.points
        credits += r.gpa_credits
        earned += r.earned_credits
        rows.append(
            TermGrades(
                term_id=term.id,
                name=term.name,
                start_date=term.start_date,
                gpa=r.gpa,
                gpa_credits=r.gpa_credits,
                earned_credits=r.earned_credits,
                cgpa=round(points / credits, 3) if credits else None,
                cumulative_credits=credits,
                cumulative_points=round(points, 3),
                in_progress=sum(1 for c in mine if not c.grade),
            )
        )
    return GradesOut(
        scale=user.scale,
        terms=rows,
        cgpa=round(points / credits, 3) if credits else None,
        total_credits=credits,
        earned_credits=earned,
        points=round(points, 3),
    )
