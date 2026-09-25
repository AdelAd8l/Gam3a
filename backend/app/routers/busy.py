from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Busy, Term, User
from ..schemas import BusyIn, BusyOut
from ..security import current_user
from .deps import get_owned

router = APIRouter(prefix="/api/busy", tags=["my timings"])


@router.get("", response_model=list[BusyOut])
def list_busy(term_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_owned(db, Term, term_id, user)
    return db.scalars(select(Busy).where(Busy.term_id == term_id).order_by(Busy.weekday, Busy.start)).all()


@router.post("", response_model=BusyOut, status_code=status.HTTP_201_CREATED)
def create_busy(data: BusyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_owned(db, Term, data.term_id, user)
    busy = Busy(user_id=user.id, **data.model_dump())
    db.add(busy)
    db.commit()
    return busy


@router.put("/{busy_id}", response_model=BusyOut)
def update_busy(busy_id: int, data: BusyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    busy = get_owned(db, Busy, busy_id, user)
    get_owned(db, Term, data.term_id, user)
    for field, value in data.model_dump().items():
        setattr(busy, field, value)
    db.commit()
    return busy


@router.delete("/{busy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_busy(busy_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(get_owned(db, Busy, busy_id, user))
    db.commit()
