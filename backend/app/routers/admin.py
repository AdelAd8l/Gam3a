"""Admin: list, edit and delete any account. Only for users with is_admin."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import SessionLocal, get_db
from ..grading import SCALES
from ..models import Assessment, Course, Term, User, delete_user
from ..schemas import Scale
from ..security import current_admin, hash_password

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminUserOut(BaseModel):
    id: int
    email: str
    name: str
    university: str
    scale: Scale
    is_admin: bool
    must_change_password: bool
    created_at: datetime
    terms: int
    courses: int
    assessments: int


class AdminUserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    email: EmailStr | None = None
    university: str | None = Field(default=None, max_length=120)
    scale: Scale | None = None
    is_admin: bool | None = None
    # Sets a temporary password; the person must choose their own at next sign-in.
    new_password: str | None = Field(default=None, min_length=8, max_length=128)


def _counts(db: Session, model) -> dict[int, int]:
    return dict(db.execute(select(model.user_id, func.count()).group_by(model.user_id)).all())


def _out(user: User, terms: dict, courses: dict, assessments: dict) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        university=user.university,
        scale=user.scale,
        is_admin=user.is_admin,
        must_change_password=user.must_change_password,
        created_at=user.created_at,
        terms=terms.get(user.id, 0),
        courses=courses.get(user.id, 0),
        assessments=assessments.get(user.id, 0),
    )


def _one(db: Session, user: User) -> AdminUserOut:
    return _out(user, _counts(db, Term), _counts(db, Course), _counts(db, Assessment))


def _target(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "No such account")
    return user


@router.get("/users", response_model=list[AdminUserOut])
def list_users(q: str = "", _: User = Depends(current_admin), db: Session = Depends(get_db)):
    stmt = select(User).order_by(User.created_at.desc(), User.id.desc())
    if q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(pattern), User.name.ilike(pattern)))
    users = db.scalars(stmt).all()
    terms, courses, assessments = _counts(db, Term), _counts(db, Course), _counts(db, Assessment)
    return [_out(u, terms, courses, assessments) for u in users]


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: int, data: AdminUserUpdate, admin: User = Depends(current_admin), db: Session = Depends(get_db)
):
    user = _target(db, user_id)
    values = data.model_dump(exclude_none=True)
    if values.get("is_admin") is False and user.id == admin.id:
        raise HTTPException(422, "You can't remove your own admin access")
    if "email" in values:
        email = values.pop("email").lower()
        taken = db.scalar(select(User).where(User.email == email, User.id != user.id))
        if taken:
            raise HTTPException(409, "An account with this email already exists")
        user.email = email
    password = values.pop("new_password", None)
    if password:
        user.password_hash = hash_password(password)
        user.session_version = (user.session_version or 0) + 1  # signs them out everywhere
        user.must_change_password = user.id != admin.id
    for field, value in values.items():
        setattr(user, field, value.strip() if isinstance(value, str) else value)
    if user.default_target not in SCALES[user.scale]:
        user.default_target = "A"
    db.commit()
    return _one(db, user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_user(user_id: int, admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    user = _target(db, user_id)
    if user.id == admin.id:
        raise HTTPException(422, "You can't delete your own account from here")
    delete_user(db, user)  # removes everything they own


def ensure_admin() -> None:
    """Create the admin account on first start, or make an existing account with that email an admin."""
    settings = get_settings()
    email = settings.admin_email.strip().lower()
    if not email:
        return
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            db.add(
                User(
                    email=email,
                    name="Admin",
                    password_hash=hash_password(settings.admin_password),
                    is_admin=True,
                    must_change_password=True,
                )
            )
        elif not user.is_admin:
            user.is_admin = True
        try:
            db.commit()
        except IntegrityError:  # another worker created it at the same moment
            db.rollback()
