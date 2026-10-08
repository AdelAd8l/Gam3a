import time
from collections import defaultdict, deque
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


MAX_PASSWORD_BYTES = 72  # bcrypt reads no further


def hash_password(password: str) -> str:
    raw = password.encode()
    if len(raw) > MAX_PASSWORD_BYTES:  # e.g. a long Arabic password (2 bytes a letter)
        raise HTTPException(422, "That password is too long. Use a shorter one.")
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    if not hashed:  # an account made with Google has no password
        return False
    return bcrypt.checkpw(password.encode()[:MAX_PASSWORD_BYTES], hashed.encode())


# Wrong passwords: after this many in the window, that email (or that address) has to wait.
FAILS_PER_EMAIL = 10
FAILS_PER_IP = 30
FAIL_WINDOW = 15 * 60  # seconds
_fails: dict[str, deque[float]] = defaultdict(deque)


def _recent(key: str, now: float) -> deque[float]:
    q = _fails[key]
    while q and q[0] < now - FAIL_WINDOW:
        q.popleft()
    if not q:
        _fails.pop(key, None)
    return q


def check_attempts(request: Request, email: str) -> None:
    """Refuse a sign-in try while this email or this address has failed too often lately."""
    now = time.monotonic()
    ip = request.client.host if request.client else ""
    if len(_recent(f"e:{email}", now)) >= FAILS_PER_EMAIL or len(_recent(f"i:{ip}", now)) >= FAILS_PER_IP:
        raise HTTPException(429, "Too many wrong passwords. Wait 15 minutes and try again.")


def record_failure(request: Request, email: str) -> None:
    now = time.monotonic()
    ip = request.client.host if request.client else ""
    if len(_fails) > 10_000:  # keep memory bounded
        for key in list(_fails):
            _recent(key, now)
    _fails[f"e:{email}"].append(now)
    _fails[f"i:{ip}"].append(now)


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
