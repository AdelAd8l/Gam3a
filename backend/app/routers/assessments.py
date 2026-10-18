import json
from datetime import date

from fastapi import APIRouter, Depends, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..limits import MAX_ASSESSMENTS, ensure_room
from ..models import Assessment, Course, User
from ..schemas import AssessmentIn, AssessmentOut
from ..security import current_user
from .deps import get_owned

router = APIRouter(prefix="/api/assessments", tags=["deadlines"])


def _fields(data: AssessmentIn) -> dict:
    """The columns to store: the steps go in as JSON text."""
    values = data.model_dump(exclude={"subtasks"})
    values["subtasks"] = json.dumps([s.model_dump() for s in data.subtasks], ensure_ascii=False)
    return values


@router.get("", response_model=list[AssessmentOut])
def list_assessments(
    term_id: int | None = None,
    course_id: int | None = None,
    start: date | None = None,
    end: date | None = None,
    open_only: bool = False,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Assessment).where(Assessment.user_id == user.id)
    if term_id is not None:
        # The term's courses, plus tasks with no course, which belong to every term.
        in_term = Assessment.course_id.in_(select(Course.id).where(Course.term_id == term_id))
        stmt = stmt.where(or_(in_term, Assessment.course_id.is_(None)))
    if course_id is not None:
        stmt = stmt.where(Assessment.course_id == course_id)
    if start:
        stmt = stmt.where(Assessment.due_date >= start)
    if end:
        stmt = stmt.where(Assessment.due_date <= end)
    if open_only:
        stmt = stmt.where(Assessment.done.is_(False))
    # Undated items last, then by date and time.
    stmt = stmt.order_by(Assessment.due_date.is_(None), Assessment.due_date, Assessment.due_time, Assessment.id)
    return db.scalars(stmt).all()


@router.get("/{item_id}", response_model=AssessmentOut)
def get_assessment(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return get_owned(db, Assessment, item_id, user)


@router.post("", response_model=AssessmentOut, status_code=status.HTTP_201_CREATED)
def create_assessment(data: AssessmentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if data.course_id is not None:
        get_owned(db, Course, data.course_id, user)
    ensure_room(db, Assessment, user.id, MAX_ASSESSMENTS, "tasks and deadlines")
    item = Assessment(user_id=user.id, **_fields(data))
    item.title = item.title.strip()
    db.add(item)
    db.commit()
    return item


@router.put("/{item_id}", response_model=AssessmentOut)
def update_assessment(item_id: int, data: AssessmentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = get_owned(db, Assessment, item_id, user)
    if data.course_id is not None:
        get_owned(db, Course, data.course_id, user)
    for field, value in _fields(data).items():
        setattr(item, field, value)
    item.title = item.title.strip()
    db.commit()
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assessment(item_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(get_owned(db, Assessment, item_id, user))
    db.commit()
