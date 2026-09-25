from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..grading import is_valid_grade
from ..models import Assessment, Course, Meeting, Term, User
from ..schemas import CourseIn, CourseOut, GradeIn, MeetingOut
from ..security import current_user
from .deps import get_owned

router = APIRouter(prefix="/api/courses", tags=["courses"])


def check_grade(grade: str | None, user: User) -> str | None:
    if grade is None or grade == "":
        return None
    grade = grade.strip().upper()
    if not is_valid_grade(grade, user.scale):
        raise HTTPException(422, f"'{grade}' isn't a grade on the {user.scale}.0 scale")
    return grade


def serialize(db: Session, courses: list[Course]) -> list[CourseOut]:
    ids = [c.id for c in courses]
    meetings: dict[int, list[Meeting]] = defaultdict(list)
    scores: dict[int, list[Assessment]] = defaultdict(list)
    if ids:
        for m in db.scalars(select(Meeting).where(Meeting.course_id.in_(ids)).order_by(Meeting.weekday, Meeting.start)):
            meetings[m.course_id].append(m)
        for a in db.scalars(select(Assessment).where(Assessment.course_id.in_(ids))):
            scores[a.course_id].append(a)

    out = []
    for c in courses:
        item = CourseOut.model_validate(c)
        item.meetings = [MeetingOut.model_validate(m) for m in meetings[c.id]]
        graded = [a for a in scores[c.id] if a.score is not None and a.weight]
        weight = sum(a.weight for a in graded)
        if weight:
            item.current_score = round(sum(a.score * a.weight for a in graded) / weight, 1)
            item.graded_weight = round(weight, 1)
        out.append(item)
    return out


def save_meetings(db: Session, course: Course, data: CourseIn, user: User) -> None:
    db.execute(delete(Meeting).where(Meeting.course_id == course.id))
    for m in data.meetings:
        db.add(Meeting(user_id=user.id, course_id=course.id, **m.model_dump()))


@router.get("", response_model=list[CourseOut])
def list_courses(term_id: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Course).where(Course.user_id == user.id)
    if term_id is not None:
        stmt = stmt.where(Course.term_id == term_id)
    return serialize(db, list(db.scalars(stmt.order_by(Course.term_id, Course.code, Course.name))))


@router.post("", response_model=CourseOut, status_code=status.HTTP_201_CREATED)
def create_course(data: CourseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_owned(db, Term, data.term_id, user)
    values = data.model_dump(exclude={"meetings"})
    values["grade"] = check_grade(data.grade, user)
    course = Course(user_id=user.id, **values)
    db.add(course)
    db.flush()
    save_meetings(db, course, data, user)
    db.commit()
    return serialize(db, [course])[0]


@router.put("/{course_id}", response_model=CourseOut)
def update_course(course_id: int, data: CourseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course = get_owned(db, Course, course_id, user)
    get_owned(db, Term, data.term_id, user)
    values = data.model_dump(exclude={"meetings"})
    values["grade"] = check_grade(data.grade, user)
    for field, value in values.items():
        setattr(course, field, value)
    save_meetings(db, course, data, user)
    db.commit()
    return serialize(db, [course])[0]


@router.put("/{course_id}/grade", response_model=CourseOut)
def set_grade(course_id: int, data: GradeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    course = get_owned(db, Course, course_id, user)
    course.grade = check_grade(data.grade, user)
    db.commit()
    return serialize(db, [course])[0]


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(get_owned(db, Course, course_id, user))
    db.commit()
