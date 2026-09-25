"""Connect a Google account and keep one calendar per course in sync (see app/google_calendar.py)."""

import secrets
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import google_calendar as gc
from ..config import get_settings
from ..database import get_db
from ..models import GoogleCalendar, GoogleEvent, GoogleLink, User
from ..security import COOKIE_NAME, current_user

router = APIRouter(prefix="/api/google", tags=["google"])


class GoogleStatus(BaseModel):
    configured: bool
    connected: bool
    email: str = ""
    include_study: bool = True
    class_reminder: int = 10
    deadline_reminder: int = 1440
    last_sync: datetime | None = None
    last_error: str = ""
    calendars: int = 0
    events: int = 0


class GoogleSettings(BaseModel):
    include_study: bool | None = None
    class_reminder: int | None = Field(default=None, ge=0, le=24 * 60)  # minutes, 0 = none
    deadline_reminder: int | None = Field(default=None, ge=0, le=14 * 24 * 60)


def _redirect_uri(request: Request) -> str:
    base = get_settings().public_url.rstrip("/") or str(request.base_url).rstrip("/")
    return f"{base}/api/google/callback"


def _status(db: Session, user: User) -> GoogleStatus:
    link = db.get(GoogleLink, user.id)
    if link is None:
        return GoogleStatus(configured=gc.configured(), connected=False)
    count = lambda model: db.scalar(select(func.count()).select_from(model).where(model.user_id == user.id))  # noqa: E731
    return GoogleStatus(
        configured=gc.configured(),
        connected=True,
        email=link.email,
        include_study=link.include_study,
        class_reminder=link.class_reminder,
        deadline_reminder=link.deadline_reminder,
        last_sync=link.last_sync,
        last_error=link.last_error,
        calendars=count(GoogleCalendar),
        events=count(GoogleEvent),
    )


@router.get("/status", response_model=GoogleStatus)
def status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _status(db, user)


@router.get("/connect")
def connect(request: Request, user: User = Depends(current_user)):
    """Send the browser to Google's consent screen."""
    if not gc.configured():
        raise HTTPException(503, "Google Calendar isn't set up on this server")
    settings = get_settings()
    state = jwt.encode(
        {"uid": user.id, "n": secrets.token_urlsafe(8), "exp": datetime.now(UTC) + timedelta(minutes=15)},
        settings.secret_key,
        algorithm="HS256",
    )
    query = {
        "client_id": settings.google_client_id,
        "redirect_uri": _redirect_uri(request),
        "response_type": "code",
        "scope": gc.SCOPES,
        "access_type": "offline",
        "prompt": "consent",  # always hand out a refresh token
        "include_granted_scopes": "true",
        "state": state,
    }
    from urllib.parse import urlencode

    return RedirectResponse(f"{gc.AUTH_URL}?{urlencode(query)}", status_code=302)


@router.get("/callback")
def callback(
    request: Request, code: str = "", state: str = "", error: str = "", db: Session = Depends(get_db)
):
    """Google sends the browser back here after the consent screen."""
    back = lambda result: RedirectResponse(f"/settings?google={result}", status_code=302)  # noqa: E731
    if error:
        return back("cancelled")
    try:
        claims = jwt.decode(state, get_settings().secret_key, algorithms=["HS256"])
        user_id = int(claims["uid"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return back("expired")
    # If someone is signed in here, it must be the same person who started connecting.
    cookie = request.cookies.get(COOKIE_NAME)
    if cookie:
        try:
            signed_in = int(jwt.decode(cookie, get_settings().secret_key, algorithms=["HS256"])["sub"])
            if signed_in != user_id:
                return back("expired")
        except (jwt.PyJWTError, KeyError, ValueError):
            pass
    user = db.get(User, user_id)
    if user is None or not code:
        return back("expired")
    try:
        tokens = gc.exchange_code(code, _redirect_uri(request))
    except gc.GoogleError:
        return back("failed")
    link = db.get(GoogleLink, user.id) or GoogleLink(user_id=user.id)
    link.refresh_token = gc.seal(tokens["refresh_token"])
    link.email = gc.email_from_id_token(tokens.get("id_token", ""))
    link.state_digest = ""  # send everything again
    link.last_error = ""
    db.add(link)
    db.commit()
    gc._tokens[user.id] = (tokens["access_token"], datetime.now(UTC) + timedelta(seconds=int(tokens.get("expires_in", 3600))))
    gc.sync(db, user, force=True)
    return back("connected")


@router.post("/sync", response_model=GoogleStatus)
def sync_now(user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = db.get(GoogleLink, user.id)
    if link is None:
        raise HTTPException(409, "Google Calendar isn't connected")
    link.last_error = ""
    db.commit()
    gc.sync(db, user, force=True)
    return _status(db, user)


@router.put("/settings", response_model=GoogleStatus)
def save_settings(data: GoogleSettings, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = db.get(GoogleLink, user.id)
    if link is None:
        raise HTTPException(409, "Google Calendar isn't connected")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(link, field, value)
    db.commit()
    gc.sync(db, user)
    return _status(db, user)


@router.post("/disconnect", response_model=GoogleStatus)
def disconnect(remove_calendars: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    gc.disconnect(db, user, remove_calendars)
    return _status(db, user)
