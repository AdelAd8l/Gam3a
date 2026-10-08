import asyncio
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from . import migrate, notify, seed
from .config import get_settings
from .database import Base, engine, get_db
from .routers import admin, assessments, auth, busy, courses, google, google_login, grades, plan, push, terms
from .site_settings import signup_open


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    migrate.upgrade(engine)
    admin.ensure_admin()
    if get_settings().demo:
        seed.run(only_if_missing=True)
    reminders = asyncio.create_task(notify.loop()) if get_settings().notifications else None
    yield
    if reminders:
        reminders.cancel()


app = FastAPI(title="Gam3a", version="1.0.0", lifespan=lifespan)

# Sent with every response: no framing by other sites (clickjacking), no type sniffing, only this
# site's own scripts, and (behind HTTPS) always HTTPS.
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; "
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)
HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in HEADERS.items():
        if name == "Content-Security-Policy" and request.url.path in ("/docs", "/redoc"):
            continue  # the API docs page loads its viewer from a CDN
        response.headers.setdefault(name, value)
    if get_settings().cookie_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")  # private data: not kept in shared caches
    return response

for module in (auth, terms, courses, busy, assessments, plan, grades, push, admin, google, google_login):
    app.include_router(module.router)


@app.get("/api/health", tags=["meta"])
def health(db: Session = Depends(get_db)):
    settings = get_settings()
    body: dict = {
        "status": "ok",
        "signup": signup_open(db),
        "google": bool(settings.google_client_id and settings.google_client_secret),
        "contact": settings.contact_email or settings.admin_email,
    }
    if settings.demo:
        body["demo"] = {"email": seed.DEMO_EMAIL, "password": seed.DEMO_PASSWORD}
    return body


mimetypes.add_type("application/manifest+json", ".webmanifest")

# Serve the built React app (frontend/dist) from the same origin, with SPA fallback.
static_dir = Path(get_settings().static_dir).resolve()
if (static_dir / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        file = (static_dir / path).resolve()
        if path and file.is_file() and file.is_relative_to(static_dir):
            return FileResponse(file)
        return FileResponse(static_dir / "index.html")
