"""FloodShield AI — FastAPI application entry point."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.core.config import get_settings
from app.core.database import SessionLocal, init_db
from app.core.rate_limit import RateLimitMiddleware
from app.engines.demo import clock
from app.routers import auth, operations, situational

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("floodshield")
settings = get_settings()

DESCRIPTION = f"""
**{settings.tagline}**

Software-only urban flood nowcasting platform (SIH26085). No IoT / sensors / hardware.

Pipeline: Weather/Radar → AI Rainfall Nowcast → DEM/Terrain → Runoff → Surface Flow → Drainage Hydraulics →
Coupled Flood Prediction → Street-Level Risk → Early Warning → Emergency Routing → Municipal Response.

Every response carries a `data_label`: LIVE_DATA · HISTORICAL_DATA · SIMULATED_DATA · DEMO_DATA · MODEL_PREDICTION · USER_REPORTED_DATA.

Authorize with **POST /api/auth/token** (demo: `admin@floodshield.local` / `Admin@123`).
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from scripts.seed import seed_if_empty
    db = SessionLocal()
    try:
        seed_if_empty(db)
    finally:
        db.close()
    from app.engines.hub import engine
    await asyncio.to_thread(lambda: engine(settings.default_city).snapshot(0))
    clock.start_background()
    log.info("FloodShield AI ready — city=%s", settings.default_city)
    yield


app = FastAPI(title="FloodShield AI API", version=settings.version, description=DESCRIPTION, lifespan=lifespan,
              docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=2000)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    return resp


for r in (auth.router, auth.admin, situational.public_router, situational.router, operations.public_router, operations.router):
    app.include_router(r)


@app.get("/", include_in_schema=False)
def root():
    return {"app": settings.app_name, "tagline": settings.tagline, "docs": "/api/docs"}
