"""Sign up and sign in with a Google account ("Continue with Google").

Standard OpenID Connect "web server" flow, asking Google only for the account's name and email:

1. /api/auth/google/start sends the browser to Google, with a signed, short-lived `state` and a
   matching random value in a cookie (so the answer can only finish in the browser that asked).
2. Google sends the browser back to /api/auth/google/callback with a code; we swap it for the
   account's details straight from Google's token endpoint (over HTTPS).
3. The Google account is matched to a user by its Google id, then by verified email; with no
   match a new account is made (only while sign-ups are open). Then the usual session cookie.
"""

import base64
import json
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import jwt
import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import User
from ..security import set_session_cookie
from ..site_settings import signup_open

router = APIRouter(prefix="/api/auth/google", tags=["auth"])

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
COOKIE = "google_login"


def configured() -> bool:
    s = get_settings()
    return bool(s.google_client_id and s.google_client_secret)


def call(method: str, url: str, *, data=None):
    """One request to Google (tests replace this)."""
    r = requests.request(method, url, data=data, timeout=20)
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {}


def _redirect_uri(request: Request) -> str:
    base = get_settings().public_url.rstrip("/") or str(request.base_url).rstrip("/")
    return f"{base}/api/auth/google/callback"


def _claims(id_token: str) -> dict:
    """The id_token came straight from Google's token endpoint over HTTPS, so we can read it."""
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except (IndexError, ValueError):
        return {}


def _zone(name: str) -> str:
    try:
        ZoneInfo(name)
        return name
    except (ZoneInfoNotFoundError, ValueError):
        return "Africa/Cairo"


@router.get("/start")
def start(request: Request, tz: str = "", lang: str = "en", currency: str = ""):
    """Send the browser to Google's account chooser."""
    if not configured():
        raise HTTPException(503, "Google sign-in isn't set up on this server")
    settings = get_settings()
    nonce = secrets.token_urlsafe(16)
    state = jwt.encode(
        {
            "n": nonce,
            "tz": tz[:64],
            "lang": lang if lang in ("en", "ar") else "en",
            "cur": currency[:3].upper(),
            "exp": datetime.now(UTC) + timedelta(minutes=10),
        },
        settings.secret_key,
        algorithm="HS256",
    )
    query = {
        "client_id": settings.google_client_id,
        "redirect_uri": _redirect_uri(request),
        "response_type": "code",
        "scope": "openid email profile",
        "prompt": "select_account",
        "state": state,
    }
    response = RedirectResponse(f"{AUTH_URL}?{urlencode(query)}", status_code=302)
    response.set_cookie(
        COOKIE, nonce, max_age=600, httponly=True, samesite="lax", secure=settings.cookie_secure, path="/api/auth/google"
    )
    return response


@router.get("/callback")
def callback(request: Request, code: str = "", state: str = "", error: str = "", db: Session = Depends(get_db)):
    def back(result: str) -> RedirectResponse:
        response = RedirectResponse(f"/login?google={result}", status_code=302)
        response.delete_cookie(COOKIE, path="/api/auth/google")
        return response

    if error:
        return back("cancelled")
    settings = get_settings()
    try:
        prefs = jwt.decode(state, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return back("expired")
    if not code or request.cookies.get(COOKIE) != prefs.get("n"):
        return back("expired")  # not started in this browser (or too long ago)

    status, tokens = call(
        "POST",
        TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": _redirect_uri(request),
            "grant_type": "authorization_code",
        },
    )
    claims = _claims(tokens.get("id_token", "")) if status == 200 else {}
    sub, email = claims.get("sub"), (claims.get("email") or "").lower()
    if not sub or not email:
        return back("failed")
    if claims.get("email_verified") is not True:
        return back("unverified")

    user = db.scalar(select(User).where(User.google_sub == sub))
    if user is None:
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            user.google_sub = sub  # the same person: link the Google account to it
        elif not signup_open(db):
            return back("closed")
        else:
            user = _new_user(db, email, claims.get("name") or email.split("@")[0], prefs)
            user.google_sub = sub
    db.commit()
    response = RedirectResponse("/", status_code=302)
    response.delete_cookie(COOKIE, path="/api/auth/google")
    set_session_cookie(response, user)
    return response


def _new_user(db: Session, email: str, name: str, prefs: dict) -> User:
    user = User(
        email=email,
        name=name[:80],
        password_hash="",  # signs in with Google; a password can be added in Settings
        timezone=_zone(prefs.get("tz") or ""),
        lang=prefs.get("lang", "en"),
    )
    db.add(user)
    db.flush()
    return user
