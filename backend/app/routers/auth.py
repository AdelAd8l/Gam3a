import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..grading import SCALES, cutoffs_for, user_cutoffs
from ..models import User, delete_user
from ..schemas import LoginIn, PasswordChange, RegisterIn, UserOut, UserUpdate
from ..security import (
    clear_session_cookie,
    current_user,
    hash_password,
    set_session_cookie,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        university=user.university,
        scale=user.scale,
        week_start=user.week_start,
        cutoffs=user_cutoffs(user),
        default_target=user.default_target if user.default_target in SCALES[user.scale] else "A",
        class_minutes=user.class_minutes or 100,
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(data: RegisterIn, response: Response, db: Session = Depends(get_db)):
    if not get_settings().allow_signup:
        raise HTTPException(403, "Sign-ups are closed on this server")
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(
        email=email,
        name=data.name.strip(),
        password_hash=hash_password(data.password),
        university=data.university.strip(),
        scale=data.scale,
    )
    db.add(user)
    db.commit()
    set_session_cookie(response, user.id)
    return user_out(user)


@router.post("/login", response_model=UserOut)
def login(data: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    set_session_cookie(response, user.id)
    return user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    clear_session_cookie(response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.patch("/me", response_model=UserOut)
def update_me(data: UserUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    values = data.model_dump(exclude_none=True)
    cutoffs = values.pop("cutoffs", None)
    for field, value in values.items():
        setattr(user, field, value.strip() if isinstance(value, str) else value)
    if user.default_target not in SCALES[user.scale]:
        user.default_target = "A"
    if cutoffs is not None:
        merged = cutoffs_for(user.scale, cutoffs)
        ordered = [merged[g] for g in SCALES[user.scale]]  # best grade first
        if any(a <= b for a, b in zip(ordered, ordered[1:], strict=False)):
            raise HTTPException(422, "Each grade needs a higher cut-off than the one below it")
        user.cutoffs = json.dumps({k: v for k, v in merged.items() if k != "F"})
    db.commit()
    return user_out(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(data: PasswordChange, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(data.new_password)
    db.commit()


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    delete_user(db, user)
    clear_session_cookie(response)
