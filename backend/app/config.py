from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GAM3A_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./gam3a.db"
    # Override in production: GAM3A_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
    secret_key: str = "dev-only-insecure-key-change-me-in-production"
    session_days: int = 14
    cookie_secure: bool = False
    # Directory with the built frontend (frontend/dist). Served by FastAPI when present.
    static_dir: str = "../frontend/dist"
    # Create demo@gam3a.dev on startup and offer it on the sign-in page (for public demos).
    demo: bool = False
    # Turn off after creating your own account to keep a personal deployment private.
    allow_signup: bool = True
    # The admin account, created on first start if it doesn't exist. The password is only a
    # starting point: the admin must choose a new one at first sign-in.
    admin_email: str = "adool1832007@gmail.com"
    # Shown on the public privacy page (/privacy). Empty = the admin email.
    contact_email: str = ""
    admin_password: str = "admin"
    # Google (optional): "Continue with Google" and Calendar sync. From Google Cloud: an OAuth client
    # of type "Web application" with the redirect URIs <public_url>/api/auth/google/callback and
    # <public_url>/api/google/callback. Leave empty to hide both.
    google_client_id: str = ""
    google_client_secret: str = ""
    # The site's own address, e.g. https://gam3a.duckdns.org (worked out from requests if empty).
    public_url: str = ""
    # Send lecture / deadline reminders (Web Push). The VAPID keys are generated and stored
    # in the database on first use; set these only to reuse keys from another install.
    notifications: bool = True
    vapid_private_key: str = ""  # PEM
    vapid_subject: str = "mailto:admin@gam3a.app"


@lru_cache
def get_settings() -> Settings:
    return Settings()
