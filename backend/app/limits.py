"""Per-user limits, so one account cannot fill the server's small disk and memory or stall the planner."""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

MAX_TERMS = 30
MAX_COURSES = 80
MAX_BUSY = 150
MAX_ASSESSMENTS = 3000
MAX_PUSH_DEVICES = 10


def count(db: Session, model, user_id: int) -> int:
    return db.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) or 0


def ensure_room(db: Session, model, user_id: int, limit: int, what: str, adding: int = 1) -> None:
    if count(db, model, user_id) + adding > limit:
        raise HTTPException(409, f"Limit reached: at most {limit:,} {what} per account")
