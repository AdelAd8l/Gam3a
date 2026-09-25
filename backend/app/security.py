from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import User

COOKIE_NAME = "gam3a_session"
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def set_session_cookie(response: Response, user: User) -> None:
    settings = get_settings()
    expires = datetime.now(UTC) + timedelta(days=settings.session_days)
    claims = {"sub": str(user.id), "v": user.session_version or 0, "exp": expires}
    token = jwt.encode(claims, settings.secret_key, algorithm=ALGORITHM)
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


# While a new password is required, only these calls are allowed.
PASSWORD_GATE = {("GET", "/api/auth/me"), ("POST", "/api/auth/password")}


def current_user(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    if not token:
        raise unauthorized
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
        version = int(payload.get("v", 0))
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized from None
    user = db.get(User, user_id)
    # A deleted account, or a session from before the last password change.
    if user is None or version != (user.session_version or 0):
        raise unauthorized
    if user.must_change_password and (request.method, request.url.path) not in PASSWORD_GATE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Choose a new password first")
    return user


def current_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only")
    return user
