from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Term, User
from ..schemas import TermIn, TermOut
from ..security import current_user
from .deps import get_owned

router = APIRouter(prefix="/api/terms", tags=["terms"])


def to_out(term: Term) -> TermOut:
    return TermOut(
        id=term.id,
        name=term.name,
        start_date=term.start_date,
        end_date=term.end_date,
        study_start=term.study_start,
        study_end=term.study_end,
        hours_per_credit=term.hours_per_credit,
        session_minutes=term.session_minutes,
        rest_days=[int(d) for d in term.rest_days.split(",") if d != ""],
    )


def apply(term: Term, data: TermIn) -> None:
    values = data.model_dump()
    values["rest_days"] = ",".join(str(d) for d in data.rest_days)
    values["name"] = data.name.strip()
    for field, value in values.items():
        setattr(term, field, value)


@router.get("", response_model=list[TermOut])
def list_terms(user: User = Depends(current_user), db: Session = Depends(get_db)):
    terms = db.scalars(select(Term).where(Term.user_id == user.id).order_by(Term.start_date))
    return [to_out(t) for t in terms]


@router.post("", response_model=TermOut, status_code=status.HTTP_201_CREATED)
def create_term(data: TermIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    term = Term(user_id=user.id)
    apply(term, data)
    db.add(term)
    db.commit()
    return to_out(term)


@router.put("/{term_id}", response_model=TermOut)
def update_term(term_id: int, data: TermIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    term = get_owned(db, Term, term_id, user)
    apply(term, data)
    db.commit()
    return to_out(term)


@router.delete("/{term_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_term(term_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(get_owned(db, Term, term_id, user))
    db.commit()
