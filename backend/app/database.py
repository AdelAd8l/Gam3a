from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings


class Base(DeclarativeBase):
    pass


def normalize_url(url: str) -> str:
    """Hosted Postgres providers hand out postgres:// or postgresql:// URLs; use the psycopg 3 driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def make_engine(url: str) -> Engine:
    url = normalize_url(url)
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if url in ("sqlite://", "sqlite:///:memory:"):
            # In-memory DB (tests): share one connection or every session sees an empty DB.
            kwargs["poolclass"] = StaticPool
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_conn, _):
            dbapi_conn.execute("PRAGMA foreign_keys = ON")
            # A database file on the server: let reads carry on while something writes,
            # and wait briefly instead of failing when two writes meet.
            dbapi_conn.execute("PRAGMA busy_timeout = 5000")
            if url not in ("sqlite://", "sqlite:///:memory:"):
                dbapi_conn.execute("PRAGMA journal_mode = WAL")
                dbapi_conn.execute("PRAGMA synchronous = NORMAL")

    return engine


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
