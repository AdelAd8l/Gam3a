from typing import TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import User

T = TypeVar("T")


def get_owned(db: Session, model: type[T], obj_id: int, user: User) -> T:
    """Fetch a row that belongs to `user`, or 404 (never reveal other users' rows)."""
    obj = db.get(model, obj_id)
    if obj is None or obj.user_id != user.id:  # type: ignore[attr-defined]
        raise HTTPException(404, f"{model.__name__} not found")
    return obj
