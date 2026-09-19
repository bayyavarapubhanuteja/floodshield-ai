"""Shared pytest fixtures.

The environment MUST be configured before any `app.*` import because settings, the
SQLAlchemy engine and the rate limiter are created at import time.
"""
import os
import sys
import tempfile

_TMP = tempfile.mkdtemp(prefix="floodshield-test-")
os.environ["FS_DATABASE_URL"] = f"sqlite:///{os.path.join(_TMP, 'test.db')}"
os.environ["FS_WEATHER_PROVIDER"] = "disabled"
os.environ["FS_ENV"] = "development"
os.environ["FS_REDIS_URL"] = ""
os.environ["FS_RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["FS_UPLOAD_DIR"] = os.path.join(_TMP, "uploads")
os.environ["FS_DEFAULT_CITY"] = "hyderabad"
for _k in ("FS_SMTP_HOST", "FS_SMS_GATEWAY_URL", "FS_YOLO_WEIGHTS"):
    os.environ.pop(_k, None)

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

CITY = "hyderabad"
DEMO_PASSWORDS = {
    "admin": ("admin@floodshield.local", "Admin@123"),
    "officer": ("officer@floodshield.local", "Demo@123"),
    "responder": ("responder@floodshield.local", "Demo@123"),
    "analyst": ("analyst@floodshield.local", "Demo@123"),
    "citizen": ("citizen@floodshield.local", "Demo@123"),
}


@pytest.fixture(scope="session")
def client():
    from app.main import app
    with TestClient(app) as c:  # runs lifespan: create tables, seed demo data, warm engine
        yield c
    from app.engines.demo import clock
    clock.control("RESET")


@pytest.fixture(scope="session")
def tokens(client):
    out = {}
    for role, (email, pw) in DEMO_PASSWORDS.items():
        r = client.post("/api/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, r.text
        out[role] = r.json()["access_token"]
    return out


@pytest.fixture(scope="session")
def auth(tokens):
    def _h(role: str) -> dict:
        return {"Authorization": f"Bearer {tokens[role]}"}
    return _h


@pytest.fixture(scope="session")
def eng():
    from app.engines.hub import engine
    return engine(CITY)


@pytest.fixture(scope="session")
def snap90(eng):
    """Snapshot near the storm peak (≈100 mm/hr) — flooding, overloads and alerts are active."""
    return eng.snapshot(90)
