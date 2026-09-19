"""Event clock + WebSocket broadcaster.

Modes:  PAUSED · RUNNING (12x: 1 event-minute every 5 s) · FAST_DEMO (180 min in ~150 s).
The clock drives which snapshot every endpoint returns by default.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import WebSocket

from app.core.config import get_settings

log = logging.getLogger("floodshield")


class WSManager:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, msg: dict):
        dead = []
        data = json.dumps(msg, default=str)
        for ws in list(self.clients):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


class DemoClock:
    END = 180.0

    def __init__(self):
        s = get_settings()
        self.minute = 0.0
        self.mode = "PAUSED"
        self.city = s.default_city
        self.fast_speed = self.END / s.demo_seconds_total   # event-min per second
        self.run_speed = 0.2
        self.updated = datetime.now(timezone.utc)
        self.ws = WSManager()
        self._last_t5 = -1
        self._task: asyncio.Task | None = None

    @property
    def speed(self) -> float:
        return {"RUNNING": self.run_speed, "FAST_DEMO": self.fast_speed}.get(self.mode, 0.0)

    def status(self) -> dict:
        return {"minute": round(self.minute, 2), "t5": int(self.minute // 5 * 5), "mode": self.mode, "city": self.city,
                "speed_min_per_sec": round(self.speed, 3), "end_minute": self.END,
                "progress": round(self.minute / self.END, 3), "updated": self.updated.isoformat()}

    def control(self, action: str, minute: float | None = None, city: str | None = None) -> dict:
        a = action.upper()
        if city:
            from app.data.cities import get_city
            get_city(city)
            self.city = city.lower()
        if a == "START":
            self.mode = "RUNNING"
        elif a == "PAUSE":
            self.mode = "PAUSED"
        elif a == "RESET":
            self.mode, self.minute = "PAUSED", 0.0
        elif a == "FAST_DEMO":
            if self.minute >= self.END - 1:
                self.minute = 0.0
            self.mode = "FAST_DEMO"
        elif a == "SEEK" and minute is not None:
            self.minute = float(min(max(minute, 0), self.END))
        elif a == "SET_CITY":
            pass
        else:
            raise ValueError(f"Unknown action {action}")
        self.updated = datetime.now(timezone.utc)
        self._last_t5 = -1
        return self.status()

    async def loop(self):
        from app.engines.hub import engine
        while True:
            try:
                if self.mode != "PAUSED":
                    self.minute = min(self.minute + self.speed, self.END)
                    if self.minute >= self.END:
                        self.mode = "PAUSED"
                t5 = int(self.minute // 5 * 5)
                msg = {"type": "clock", **self.status()}
                if t5 != self._last_t5:
                    snap = await asyncio.to_thread(engine(self.city).snapshot, t5)
                    self._last_t5 = t5
                    msg = {"type": "tick", **self.status(), "kpis": snap["kpis"],
                           "alerts": [{"id": a["id"], "level": a["level"], "title": a["title"], "location": a["location"],
                                       "expected_time_min": a["expected_time_min"], "expected_depth_m": a["expected_depth_m"]}
                                      for a in snap["alerts"][:12]]}
                    await asyncio.to_thread(_persist, self.city, snap)
                await self.ws.broadcast(msg)
            except Exception as ex:  # noqa: BLE001
                log.exception("clock loop error: %s", ex)
            await asyncio.sleep(1.0)

    def start_background(self):
        if self._task is None:
            self._task = asyncio.create_task(self.loop())


_persisted: set[tuple[str, int]] = set()


def _persist(city: str, snap: dict) -> None:
    """Store model outputs (alerts, predictions, drainage events) for audit & analytics."""
    key = (city, snap["event_minute"])
    if key in _persisted:
        return
    _persisted.add(key)
    from app.core.database import SessionLocal
    from app.models import AIPrediction, Alert, DrainageEvent, FloodPrediction
    db = SessionLocal()
    try:
        k = snap["kpis"]
        db.add(FloodPrediction(city=city, horizon_min=60, max_depth_m=k["max_depth_60_m"], flooded_cells=0,
                               flooded_roads=k["flooded_roads_60"], confidence=k["nowcast_confidence_60"] or 0,
                               summary={"event_minute": snap["event_minute"], "kpis": k}))
        db.add(AIPrediction(city=city, model="nowcast", kind="rainfall", payload=snap["nowcast"],
                            confidence=k["nowcast_confidence_60"] or 0))
        db.query(Alert).filter(Alert.city == city, Alert.active.is_(True)).update({"active": False})
        for a in snap["alerts"]:
            db.add(Alert(city=city, level=a["level"], title=a["title"], location=a["location"], lat=a["lat"], lon=a["lon"],
                         expected_time_min=a["expected_time_min"], expected_depth_m=a["expected_depth_m"],
                         affected_roads=a["affected_roads"], affected_infrastructure=a["affected_infrastructure"],
                         recommended_action=" ".join(a["recommended_actions"]["authority"]), factors=a["triggers"], active=True))
        for d in snap["drains"]:
            if d["status"] in ("OVERLOADED", "OVERFLOW"):
                db.add(DrainageEvent(city=city, node_id=d["id"], state=d["status"], utilization=d["utilization"],
                                     overflow_m3s=d["overflow_m3"]))
        db.commit()
    except Exception as ex:  # noqa: BLE001
        db.rollback()
        log.warning("persist failed: %s", ex)
    finally:
        db.close()


clock = DemoClock()
