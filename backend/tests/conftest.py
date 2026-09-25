import os

# Set TEST_DATABASE_URL to run the suite against Postgres instead of in-memory SQLite.
os.environ["GAM3A_DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite://")
os.environ["GAM3A_STATIC_DIR"] = "/nonexistent"
os.environ["GAM3A_NOTIFICATIONS"] = "false"
os.environ["GAM3A_SECRET_KEY"] = "test-secret-key-that-is-long-enough-for-hs256"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c


def signup(client, email="ada@example.com", password="correct-horse"):
    r = client.post("/api/auth/register", json={"email": email, "name": "Ada", "password": password})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def user(client):
    return signup(client)


TERM = {"name": "Fall 2026", "start_date": "2026-09-19", "end_date": "2026-12-31"}


@pytest.fixture
def term(client, user):
    r = client.post("/api/terms", json=TERM)
    assert r.status_code == 201, r.text
    return r.json()


def add_course(client, term_id, name="Data Structures", credits=3, meetings=(), grade=None, **extra):
    body = {"term_id": term_id, "name": name, "credits": credits, "meetings": list(meetings), "grade": grade, **extra}
    r = client.post("/api/courses", json=body)
    assert r.status_code == 201, r.text
    return r.json()
