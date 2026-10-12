import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import notify
from ..database import get_db
from ..limits import MAX_PUSH_DEVICES, ensure_room
from ..models import PushSubscription, User
from ..security import current_user

router = APIRouter(prefix="/api/push", tags=["notifications"])


class Keys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


# The browsers' push services. The server sends to whatever address a phone registers, so only
# these are accepted (never an address inside the server's own network).
PUSH_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "updates.push.services.mozilla.com",
    ".push.services.mozilla.com",
    ".notify.windows.com",
    "web.push.apple.com",
    ".push.apple.com",
)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(pattern=r"^https://", max_length=1000)
    keys: Keys

    @field_validator("endpoint")
    @classmethod
    def known_push_service(cls, v: str) -> str:
        url = urlsplit(v)
        host = (url.hostname or "").lower()
        if url.port not in (None, 443) or not any(host == h or (h[0] == "." and host.endswith(h)) for h in PUSH_HOSTS):
            raise ValueError("not a browser push service")
        return v


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.get("/key")
def key(db: Session = Depends(get_db)):
    return {"public_key": notify.public_key(db)}


@router.post("/subscribe", status_code=204)
def subscribe(data: SubscriptionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint))
    if sub is None or sub.user_id != user.id:
        ensure_room(db, PushSubscription, user.id, MAX_PUSH_DEVICES, "notification devices")
    if sub is None:
        sub = PushSubscription(endpoint=data.endpoint)
        db.add(sub)
    # A phone that signs in to another account moves to that account.
    sub.user_id = user.id
    sub.p256dh = data.keys.p256dh
    sub.auth = data.keys.auth
    db.commit()


@router.post("/unsubscribe", status_code=204)
def unsubscribe(data: EndpointIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint, PushSubscription.user_id == user.id))
    if sub:
        db.delete(sub)
        db.commit()


_last_test: dict[int, float] = {}
TEST_COOLDOWN = 30  # seconds between two test notifications for one account


@router.post("/test")
def test(user: User = Depends(current_user), db: Session = Depends(get_db)):
    now = time.monotonic()
    if now - _last_test.get(user.id, -TEST_COOLDOWN) < TEST_COOLDOWN:
        raise HTTPException(429, "Wait a moment before sending another test")
    ar = user.lang == "ar"
    payload = {
        "title": "Gam3a",
        "body": "الإشعارات تعمل على هذا الجهاز." if ar else "Notifications work on this device.",
        "url": "/settings",
        "tag": "test",
    }
    sent = notify.send_to_user(db, user.id, payload)
    if not sent:
        raise HTTPException(409, "No device is set up for notifications yet")
    if len(_last_test) > 5000:
        _last_test.clear()
    _last_test[user.id] = now  # only a test that really went out starts the wait
    return {"sent": sent}
