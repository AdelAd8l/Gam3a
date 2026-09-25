from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import notify
from ..database import get_db
from ..models import PushSubscription, User
from ..security import current_user

router = APIRouter(prefix="/api/push", tags=["notifications"])


class Keys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(pattern=r"^https://", max_length=1000)
    keys: Keys


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.get("/key")
def key(db: Session = Depends(get_db)):
    return {"public_key": notify.public_key(db)}


@router.post("/subscribe", status_code=204)
def subscribe(data: SubscriptionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint))
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


@router.post("/test")
def test(user: User = Depends(current_user), db: Session = Depends(get_db)):
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
    return {"sent": sent}
