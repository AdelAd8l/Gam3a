"""Site-wide settings that admins change from the website, stored in the database.

Each one falls back to the server's environment setting until an admin changes it.
"""

from sqlalchemy.orm import Session

from .config import get_settings
from .models import AppKey

SIGNUP_KEY = "allow_signup"


def signup_open(db: Session) -> bool:
    row = db.get(AppKey, SIGNUP_KEY)
    return get_settings().allow_signup if row is None else row.value == "true"


def set_signup_open(db: Session, value: bool) -> None:
    row = db.get(AppKey, SIGNUP_KEY)
    if row is None:
        db.add(AppKey(name=SIGNUP_KEY, value="true" if value else "false"))
    else:
        row.value = "true" if value else "false"
    db.commit()
