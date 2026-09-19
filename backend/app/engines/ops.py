"""Operational engines: predictive drain maintenance, model validation, data quality,
live-weather adapter and notification adapters (web / email / SMS — no hardware)."""
from __future__ import annotations

import logging
import math
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from functools import lru_cache

import httpx
import numpy as np

from app.core.config import get_settings
from app.engines.hydro import FLOOD_DEPTH
from app.engines.rainfall import HORIZONS, nowcast
from app.engines.world import get_world

log = logging.getLogger("floodshield")


# ------------------------------------------------------------------ maintenance
def maintenance(city: str, snap: dict) -> list[dict]:
    """Rank drains for INSPECT / CLEAN / REPAIR / MONITOR (no physical sensors)."""
    w = get_world(city)
    from app.engines.hub import engine
    e = engine(city)
    # utilisation under the design storm peak (from the event timeline) + flood contribution
    peak = max(e.frames, key=lambda f: sum(1 for s in f["states"].values() if s in ("OVERLOADED", "OVERFLOW")))
    hmax = np.max([f["h"] for f in e.frames[: 36]], axis=0)
    edge_from = {x["from"]: x for x in w.drain_edges}
    recs = []
    for nd in w.drain_nodes:
        if nd["kind"] == "outfall":
            continue
        k = nd["id"]
        util_peak = peak["util"].get(k, 0)
        cells = w.node_cells.get(k, [])
        flood_contrib = float(hmax.ravel()[cells].mean()) if len(cells) else 0.0
        edge = edge_from.get(k, {})
        f_block = min(nd["baseline_blockage"] / 0.35, 1)
        f_age = min(nd["days_since_cleaning"] / 240, 1)
        f_util = min(util_peak / 2, 1)
        f_hist = min(nd["historical_failures"] / 4, 1)
        f_flood = min(flood_contrib / 0.4, 1)
        f_struct = 1.0 if edge.get("legacy_undersized") else 0.5 if edge.get("adverse_grade") else 0.0
        score = 0.25 * f_block + 0.15 * f_age + 0.2 * f_util + 0.15 * f_hist + 0.15 * f_flood + 0.10 * f_struct
        reasons = []
        if f_block > 0.6:
            reasons.append(f"assumed blockage {nd['baseline_blockage']*100:.0f}% ({nd['days_since_cleaning']} days since cleaning)")
        if f_util > 0.5:
            reasons.append(f"peak utilisation {util_peak*100:.0f}% in design storm")
        if f_hist > 0.2:
            reasons.append(f"{nd['historical_failures']} historical failures")
        if f_flood > 0.3:
            reasons.append(f"contributes to ponding (mean {flood_contrib:.2f} m in catchment)")
        if edge.get("legacy_undersized"):
            reasons.append("legacy undersized conduit")
        if edge.get("adverse_grade"):
            reasons.append("adverse/flat pipe gradient (sediment trap)")
        if f_struct >= 1.0 and (f_util > 0.6 or f_hist > 0.4):
            action = "REPAIR"
        elif f_block > 0.55 or (f_age > 0.7 and f_util > 0.4):
            action = "CLEAN"
        elif score > 0.35:
            action = "INSPECT"
        else:
            action = "MONITOR"
        recs.append({"node_id": k, "kind": nd["kind"], "ward": nd["ward"], "lat": nd["lat"], "lon": nd["lon"],
                     "action": action, "priority_score": round(score, 3),
                     "priority": "P1" if score > 0.55 else "P2" if score > 0.4 else "P3",
                     "reasons": reasons or ["no significant issue"], "assumed_blockage": nd["baseline_blockage"],
                     "days_since_cleaning": nd["days_since_cleaning"], "peak_utilization": round(util_peak, 2),
                     "historical_failures": nd["historical_failures"], "flood_contribution_m": round(flood_contrib, 3),
                     "data_label": "MODEL_PREDICTION",
                     "basis": "Utilisation from simulation + maintenance-age blockage assumption (no sensors)"})
    return sorted(recs, key=lambda r: -r["priority_score"])


# ------------------------------------------------------------------ validation
@lru_cache(maxsize=8)
def validation(city: str) -> dict:
    """Twin-experiment validation against the platform's own synthetic truth (DEMO_VALIDATION)."""
    from app.engines.hub import engine
    e = engine(city)
    rain_err = {h: [] for h in HORIZONS}
    rain_cell_err = {h: [] for h in HORIZONS}
    tp = fp = fn = 0
    depth_err = []
    per_h_flood = {h: {"tp": 0, "fp": 0, "fn": 0} for h in (30, 60, 120)}
    for t in range(15, 181, 15):
        nc, fc = e.forecast(t)
        for hz in nc["horizons"]:
            h = hz["horizon_min"]
            if t + h > 360:
                continue
            truth = e.scn.field(t + h)
            rain_err[h].append(hz["intensity_mm_hr"] - truth.mean())
            rain_cell_err[h].append(float(np.sqrt(np.mean((nc["_fields"][h // 5 - 1] - truth) ** 2))))
        for h in (30, 60, 120):
            pred = fc[h // 5]["h"]
            tru = e.frames[(t + h) // 5]["h"]
            pb, tb = pred >= FLOOD_DEPTH, tru >= FLOOD_DEPTH
            a, b, c = int((pb & tb).sum()), int((pb & ~tb).sum()), int((~pb & tb).sum())
            per_h_flood[h]["tp"] += a; per_h_flood[h]["fp"] += b; per_h_flood[h]["fn"] += c
            tp += a; fp += b; fn += c
            wet = pb | tb
            if wet.any():
                depth_err.extend((pred[wet] - tru[wet]).tolist())

    def prf(tp_=0, fp_=0, fn_=0, tp=None, fp=None, fn=None):
        tp_, fp_, fn_ = (tp if tp is not None else tp_), (fp if fp is not None else fp_), (fn if fn is not None else fn_)
        p = tp_ / (tp_ + fp_) if tp_ + fp_ else 0
        r = tp_ / (tp_ + fn_) if tp_ + fn_ else 0
        f1 = 2 * p * r / (p + r) if p + r else 0
        iou = tp_ / (tp_ + fp_ + fn_) if tp_ + fp_ + fn_ else 0
        return {"precision": round(p, 3), "recall": round(r, 3), "f1": round(f1, 3), "iou": round(iou, 3)}
    rain = [{"horizon_min": h, "mae_mm_hr": round(float(np.mean(np.abs(v))), 2), "rmse_mm_hr": round(float(np.sqrt(np.mean(np.square(v)))), 2),
             "cell_rmse_mm_hr": round(float(np.mean(rain_cell_err[h])), 2), "n": len(v)} for h, v in rain_err.items() if v]
    de = np.array(depth_err) if depth_err else np.zeros(1)
    return {
        "city": city, "validation_type": "DEMO_VALIDATION",
        "description": ("Twin experiment: nowcasts and flood forecasts issued every 15 min are scored against the platform's "
                        "own synthetic 'truth' storm and coupled-model run. This verifies internal consistency and forecast "
                        "degradation with lead time. It is NOT real-world validation."),
        "real_world_validation": {"status": "NOT_AVAILABLE",
                                  "requirement": "Observed radar QPE (IMD DWR), rain-gauge-independent flood extents (SAR/Sentinel-1, "
                                                 "municipal waterlogging logs) and surveyed depth marks for the deployment city."},
        "rainfall": rain,
        "flood_extent": {"overall": prf(tp, fp, fn), "by_horizon": {str(h): prf(**v) for h, v in per_h_flood.items()}},
        "depth": {"mae_m": round(float(np.mean(np.abs(de))), 3), "rmse_m": round(float(np.sqrt(np.mean(de ** 2))), 3), "n_cells": int(len(de))},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ------------------------------------------------------------------ live weather adapter
_live_cache: dict = {}


def live_weather(city: str) -> dict:
    """Open-Meteo (no key) current precipitation for the city centre — LIVE_DATA when reachable."""
    w = get_world(city)
    now = datetime.now(timezone.utc)
    c = _live_cache.get(city)
    if c and (now - c["_at"]).total_seconds() < 600:
        return {k: v for k, v in c.items() if k != "_at"}
    settings = get_settings()
    lat, lon = w.meta["center"]
    res = {"provider": "open-meteo.com", "status": "OFFLINE", "data_label": "LIVE_DATA", "city": city}
    if settings.weather_provider == "disabled":
        res["status"] = "DISABLED"
        return res
    try:
        r = httpx.get("https://api.open-meteo.com/v1/forecast",
                      params={"latitude": lat, "longitude": lon, "current": "precipitation,rain,temperature_2m,relative_humidity_2m",
                              "minutely_15": "precipitation", "forecast_minutely_15": 12, "timezone": "UTC"}, timeout=4)
        r.raise_for_status()
        j = r.json()
        cur = j.get("current", {})
        m15 = j.get("minutely_15", {})
        res.update({"status": "ONLINE", "observed_at": cur.get("time"),
                    "precipitation_mm": cur.get("precipitation"), "temperature_c": cur.get("temperature_2m"),
                    "humidity_pct": cur.get("relative_humidity_2m"),
                    "next_3h_15min_mm": [{"time": t, "mm": v} for t, v in zip(m15.get("time", []), m15.get("precipitation", []))]})
    except Exception as ex:  # noqa: BLE001
        res["error"] = str(ex)[:120]
    _live_cache[city] = {**res, "_at": now}
    return res


# ------------------------------------------------------------------ data quality
def data_quality(city: str, snap: dict, n_reports: int = 0, n_media: int = 0, check_live: bool = False) -> dict:
    w = get_world(city)
    now = datetime.now(timezone.utc).isoformat()
    rain_series = [f["rain_mean"] for f in __import__("app.engines.hub", fromlist=["engine"]).engine(city).frames[: snap["event_minute"] // 5 + 1]]
    jumps = np.abs(np.diff(rain_series)) if len(rain_series) > 1 else np.zeros(1)
    anomalies = []
    if len(jumps) > 3 and jumps.max() > 3 * (jumps.std() + 1e-6) + jumps.mean():
        anomalies.append("Rainfall step change exceeds 3σ of recent variability")
    dem_ok = bool(np.isfinite(w.dem).all())
    live = live_weather(city) if check_live else {"status": "NOT_CHECKED"}
    sources = [
        {"source": "Rainfall field (radar-like)", "type": "SIMULATED_DATA", "status": "ONLINE", "last_updated": snap["issued_at"],
         "completeness_pct": 100.0, "confidence": 0.9, "anomalies": anomalies,
         "note": "Deterministic storm simulation used because no Doppler radar feed is configured."},
        {"source": "Live weather API (Open-Meteo)", "type": "LIVE_DATA",
         "status": {"ONLINE": "ONLINE", "NOT_CHECKED": "DEGRADED", "DISABLED": "OFFLINE"}.get(live["status"], "OFFLINE"),
         "last_updated": live.get("observed_at"), "completeness_pct": 100.0 if live["status"] == "ONLINE" else 0.0,
         "confidence": 0.8 if live["status"] == "ONLINE" else 0.0, "anomalies": [] if live["status"] == "ONLINE" else [live.get("error", "Not reachable / not checked")],
         "note": "Reference only — point precipitation at city centre."},
        {"source": "Nowcast model", "type": "MODEL_PREDICTION", "status": "ONLINE", "last_updated": snap["issued_at"],
         "completeness_pct": 100.0, "confidence": snap["kpis"]["nowcast_confidence_60"] or 0.0, "anomalies": snap["nowcast"]["anomalies"]},
        {"source": "DEM (elevation)", "type": "DEMO_DATA", "status": "ONLINE" if dem_ok else "DEGRADED", "last_updated": now,
         "completeness_pct": 100.0 if dem_ok else 90.0, "confidence": 0.7, "anomalies": [] if dem_ok else ["NaN cells"]},
        {"source": "Road network", "type": "DEMO_DATA", "status": "ONLINE", "last_updated": now, "completeness_pct": 100.0,
         "confidence": 0.7, "anomalies": [], "note": f"{len(w.roads)} segments / {len(w.road_nodes)} junctions"},
        {"source": "Drainage network", "type": "DEMO_DATA", "status": "ONLINE", "last_updated": now, "completeness_pct": 100.0,
         "confidence": 0.6, "anomalies": [f"{sum(1 for e in w.drain_edges if e['adverse_grade'])} conduits with adverse grade"],
         "note": "Blockage values are ASSUMED (maintenance-age model)."},
        {"source": "Land use / imperviousness", "type": "DEMO_DATA", "status": "ONLINE", "last_updated": now,
         "completeness_pct": 100.0, "confidence": 0.65, "anomalies": []},
        {"source": "Historical flood catalogue", "type": "DEMO_DATA", "status": "ONLINE", "last_updated": now,
         "completeness_pct": 100.0, "confidence": 0.5, "anomalies": [], "note": "Synthetic reconstruction"},
        {"source": "Citizen reports", "type": "USER_REPORTED_DATA", "status": "ONLINE", "last_updated": now,
         "completeness_pct": 100.0, "confidence": 0.5, "anomalies": [], "note": f"{n_reports} reports"},
        {"source": "CCTV / media uploads", "type": "USER_REPORTED_DATA", "status": "ONLINE", "last_updated": now,
         "completeness_pct": 100.0, "confidence": 0.6, "anomalies": [], "note": f"{n_media} analysed files (no live feeds)"},
    ]
    online = sum(1 for s in sources if s["status"] == "ONLINE")
    overall = "ONLINE" if online == len(sources) else "DEGRADED" if online >= len(sources) - 2 else "OFFLINE"
    return {"city": city, "overall": overall, "sources": sources, "checked_at": now}


# ------------------------------------------------------------------ notifications
class Notifier:
    """Adapters: WEB (WebSocket broadcast), EMAIL (SMTP if configured), SMS (gateway HTTP if configured).
    Unconfigured channels are logged as SIMULATED deliveries — never hardware."""

    def __init__(self):
        import os
        self.smtp = os.environ.get("FS_SMTP_HOST")
        self.sms_url = os.environ.get("FS_SMS_GATEWAY_URL")
        self.outbox: list[dict] = []

    def send(self, channel: str, to: str, subject: str, body: str) -> dict:
        rec = {"channel": channel, "to": to, "subject": subject, "body": body[:500],
               "at": datetime.now(timezone.utc).isoformat(), "status": "SIMULATED"}
        try:
            if channel == "EMAIL" and self.smtp:
                msg = EmailMessage()
                msg["Subject"], msg["To"], msg["From"] = subject, to, "alerts@floodshield.local"
                msg.set_content(body)
                with smtplib.SMTP(self.smtp, timeout=5) as s:
                    s.send_message(msg)
                rec["status"] = "SENT"
            elif channel == "SMS" and self.sms_url:
                httpx.post(self.sms_url, json={"to": to, "text": f"{subject}: {body}"[:320]}, timeout=5)
                rec["status"] = "SENT"
            elif channel == "WEB":
                rec["status"] = "BROADCAST"
        except Exception as ex:  # noqa: BLE001
            rec["status"] = f"FAILED: {ex}"[:120]
        self.outbox.insert(0, rec)
        del self.outbox[200:]
        return rec


notifier = Notifier()


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))
