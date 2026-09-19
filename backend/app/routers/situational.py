"""Situational-awareness APIs: rainfall, terrain, runoff, drainage, flood, risk,
infrastructure, alerts, map layers and the command-center dashboard."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.security import get_current_user, require_roles
from app.data.cities import CITIES
from app.engines import alerts as alert_rules
from app.engines import terrain as terrain_engine
from app.engines.demo import clock
from app.engines.hub import compact_grid, engine, public
from app.engines.rainfall import HORIZONS, classify
from app.engines.risk import ml_importances, ml_model, vulnerability_index, WEIGHTS
from app.engines.world import LANDCOVER, get_world

router = APIRouter(prefix="/api", tags=["Situational awareness"], dependencies=[Depends(get_current_user)])
public_router = APIRouter(prefix="/api", tags=["Public"])


def resolve(city: str | None, t: float | None):
    c = (city or clock.city).lower()
    if c not in CITIES:
        raise HTTPException(404, f"Unknown city {c}")
    tt = clock.minute if t is None else t
    e = engine(c)
    return c, e, e.snapshot(tt)


Q_CITY = Query(None, description="City key (default: active clock city)")
Q_T = Query(None, description="Event minute (default: demo clock)")


def meta(snap: dict, label: str, sources: list[str]) -> dict:
    return {"city": snap["city"], "event_minute": snap["event_minute"], "issued_at": snap["issued_at"],
            "data_label": label, "sources": sources}


# ------------------------------------------------------------------ public
@public_router.get("/cities")
def cities():
    return [{"key": k, "name": v["name"], "state": v["state"], "center": v["center"], "river": v["river"]} for k, v in CITIES.items()]


@public_router.get("/alerts/public", tags=["Alerts"])
def public_alerts(city: str | None = Q_CITY, lang: str = "en"):
    """Citizen-facing alerts (no login) in en/hi/te/ta/mr."""
    c, e, snap = resolve(city, None)
    return {**meta(snap, "MODEL_PREDICTION", ["Early warning engine"]),
            "alerts": [{"id": a["id"], "level": a["level"], "location": a["location"], "lat": a["lat"], "lon": a["lon"],
                        "expected_time_min": a["expected_time_min"], "expected_depth_m": a["expected_depth_m"],
                        "message": a["messages"].get(lang, a["messages"]["en"]),
                        "affected_roads": [r["name"] for r in a["affected_roads"]]} for a in snap["alerts"]]}


# ------------------------------------------------------------------ dashboard
@router.get("/dashboard", tags=["Dashboard"])
def dashboard(city: str | None = Q_CITY, t: float | None = Q_T):
    c, e, snap = resolve(city, t)
    return {**meta(snap, "MODEL_PREDICTION", ["Simulated rainfall", "Nowcast", "Coupled flood engine"]),
            "clock": clock.status(), "kpis": snap["kpis"], "nowcast": snap["nowcast"], "alerts": snap["alerts"][:10],
            "critical_locations": snap["critical_locations"], "wards": snap["wards"],
            "facilities_affected": [f for f in snap["facilities"] if f["status"] != "OPERATIONAL"],
            "history": e.history(snap["event_minute"]), "compute_ms": snap["compute_ms"]}


# ------------------------------------------------------------------ rainfall
@router.get("/rainfall/current", tags=["Rainfall"])
def rainfall_current(city: str | None = Q_CITY, t: float | None = Q_T, include_grid: bool = True):
    c, e, snap = resolve(city, t)
    now = snap["_now"]
    obs = e.scn.observed(snap["event_minute"])
    w = get_world(c)
    wards = [{"ward": wd["name"], "mm_hr": round(float(obs[w.ward == i].mean()), 1)} for i, wd in enumerate(w.wards)]
    return {**meta(snap, "SIMULATED_DATA", ["Deterministic radar-like storm simulation (no radar feed configured)"]),
            "mean_mm_hr": round(float(obs.mean()), 1), "max_mm_hr": round(float(obs.max()), 1),
            "category": classify(float(obs.mean())), "cumulative_mm": round(now["cum_rain_mm"], 1),
            "wards": wards, "grid": compact_grid(obs, 0.5, 1) if include_grid else None,
            "history": [{"event_minute": h["event_minute"], "mm_hr": h["rain_mm_hr"], "cum_mm": h["cum_rain_mm"]} for h in e.history(snap["event_minute"])]}


@router.get("/rainfall/forecast", tags=["Rainfall"])
def rainfall_forecast(city: str | None = Q_CITY, t: float | None = Q_T, horizon: int | None = None):
    c, e, snap = resolve(city, t)
    nc, fc = e.forecast(snap["event_minute"])
    out = {**meta(snap, "MODEL_PREDICTION", [nc["model"]]), **{k: v for k, v in nc.items() if not k.startswith("_")}}
    truth_ref = [{"horizon_min": h, "simulated_truth_mm_hr": round(e.scn.mean_intensity(snap["event_minute"] + h), 1)} for h in HORIZONS]
    out["demo_truth_reference"] = {"label": "SIMULATED_DATA (scenario truth, shown for demo validation only)", "values": truth_ref}
    if horizon is not None:
        k = max(1, min(horizon // 5, 36))
        out["grid_horizon_min"] = k * 5
        out["grid"] = compact_grid(nc["_fields"][k - 1], 0.5, 1)
    return out


@router.get("/rainfall/live", tags=["Rainfall"])
def rainfall_live(city: str | None = Q_CITY):
    from app.engines.ops import live_weather
    c = (city or clock.city).lower()
    return live_weather(c)


# ------------------------------------------------------------------ terrain & runoff
@router.get("/terrain", tags=["Terrain & Runoff"])
def terrain(city: str | None = Q_CITY, cells: bool = False):
    c = (city or clock.city).lower()
    s = terrain_engine.summary(c)
    if not cells:
        s = {k: v for k, v in s.items() if k != "cells"}
    return s


LAYERS = ["elevation", "slope", "aspect", "flow_accumulation", "catchment", "low_lying", "water_paths", "depression",
          "imperviousness", "landcover", "runoff_coefficient"]


@router.get("/terrain/layer", tags=["Terrain & Runoff"])
def terrain_layer(name: str, city: str | None = Q_CITY):
    c = (city or clock.city).lower()
    if name not in LAYERS:
        raise HTTPException(400, f"layer must be one of {LAYERS}")
    w = get_world(c)
    t = terrain_engine.analyse(c)
    grid = {"elevation": w.dem, "slope": t["slope_pct"], "aspect": t["aspect"], "flow_accumulation": np.log10(t["flow_acc"]),
            "catchment": t["catchment"].astype(float), "low_lying": t["low_lying"].astype(float),
            "water_paths": t["water_paths"].astype(float), "depression": t["depression"],
            "imperviousness": w.impervious, "landcover": w.landcover.astype(float),
            "runoff_coefficient": np.vectorize(lambda v: LANDCOVER[int(v)]["C"])(w.landcover)}[name]
    minv = -1e9 if name in ("elevation", "slope", "aspect", "imperviousness", "landcover", "runoff_coefficient", "flow_accumulation") else 0.5 if name != "depression" else 0.05
    return {"layer": name, "city": c, "min": round(float(grid.min()), 3), "max": round(float(grid.max()), 3),
            "cells": compact_grid(grid, minv, 3), "data_label": "DEMO_DATA",
            "legend": {k: v["name"] for k, v in LANDCOVER.items()} if name == "landcover" else None}


@router.get("/runoff", tags=["Terrain & Runoff"])
def runoff(city: str | None = Q_CITY, t: float | None = Q_T):
    c, e, snap = resolve(city, t)
    now = snap["_now"]
    w = get_world(c)
    rate = now["runoff_rate"]
    cum = now["cum_runoff_mm"]
    rain_cum = now["cum_rain_mm"]
    per_ha = rate / (w.cell_area / 1e4)
    hot = np.argsort(-per_ha, axis=None)[:10]
    hotspots = []
    for idx in hot:
        r, cc = divmod(int(idx), w.n)
        hotspots.append({"r": r, "c": cc, "lat_lon": w.rc_to_latlon(r, cc), "ward": w.wards[int(w.ward[r, cc])]["name"],
                         "runoff_l_s_ha": round(float(per_ha[r, cc]) * 1000, 1), "cum_runoff_mm": round(float(cum[r, cc]), 1),
                         "landcover": LANDCOVER[int(w.landcover[r, cc])]["name"]})
    wards = []
    for i, wd in enumerate(w.wards):
        m = w.ward == i
        wards.append({"ward": wd["name"], "runoff_m3s": round(float(rate[m].sum()), 2), "cum_runoff_mm": round(float(cum[m].mean()), 1),
                      "runoff_ratio": round(float(cum[m].mean() / rain_cum), 2) if rain_cum > 0 else 0})
    return {**meta(snap, "MODEL_PREDICTION", ["SCS Curve Number runoff on simulated rainfall"]),
            "method": "SCS-CN on cumulative rainfall per cell (Ia = 0.2S); CN by land-use class, adjusted for imperviousness",
            "total_runoff_rate_m3s": round(float(rate.sum()), 1), "runoff_volume_step_m3": round(float(rate.sum() * 300), 0),
            "cumulative_rain_mm": round(rain_cum, 1), "cumulative_runoff_mm": round(float(cum.mean()), 1),
            "runoff_ratio": round(float(cum.mean() / rain_cum), 3) if rain_cum > 0 else 0,
            "hotspots": hotspots, "wards": sorted(wards, key=lambda x: -x["runoff_m3s"]),
            "grid": compact_grid(per_ha * 1000, 1.0, 1), "grid_units": "L/s/ha",
            "coefficients": {v["name"]: {"C": v["C"], "CN": v["CN"], "impervious": v["impervious"]} for v in LANDCOVER.values()},
            "history": [{"event_minute": h["event_minute"], "runoff_m3s": h["runoff_m3s"], "rain_mm_hr": h["rain_mm_hr"]} for h in e.history(snap["event_minute"])]}


# ------------------------------------------------------------------ drainage
@router.get("/drains", tags=["Drainage"])
def drains(city: str | None = Q_CITY, t: float | None = Q_T, status: str | None = None):
    c, e, snap = resolve(city, t)
    ds = snap["drains"]
    if status:
        ds = [d for d in ds if d["status"] == status.upper()]
    return {**meta(snap, "MODEL_PREDICTION", ["Drainage digital twin (DEMO network, SIMULATED loads)"]),
            "summary": {"nodes": len(snap["drains"]), "edges": len(snap["edges"]), "state_counts": snap["kpis"]["drainage_state_counts"],
                        "mean_utilization": snap["kpis"]["drainage_utilization_mean"],
                        "bottlenecks": sum(1 for e_ in snap["edges"] if e_["bottleneck"]),
                        "backflow_nodes": sum(1 for d in snap["drains"] if d["backflow"]),
                        "total_overflow_m3": round(sum(d["overflow_m3"] for d in snap["drains"]), 1)},
            "nodes": ds, "edges": snap["edges"]}


@router.get("/drains/{node_id}", tags=["Drainage"])
def drain_detail(node_id: str, city: str | None = Q_CITY, t: float | None = Q_T):
    c, e, snap = resolve(city, t)
    d = next((x for x in snap["drains"] if x["id"] == node_id.upper()), None)
    if not d:
        raise HTTPException(404, "Drain node not found")
    series = [{"event_minute": int(f["t"]), "utilization": f["util"].get(d["id"], 0), "state": f["states"].get(d["id"])}
              for f in e.frames[: snap["event_minute"] // 5 + 1]]
    nc, fc = e.forecast(snap["event_minute"])
    fcs = [{"offset_min": k * 5, "utilization": fc[k]["util"].get(d["id"], 0), "state": fc[k]["states"].get(d["id"])} for k in range(0, 37, 3)]
    edge = next((x for x in snap["edges"] if x["from"] == d["id"]), None)
    return {**d, "history": series, "forecast": fcs, "outgoing_conduit": edge, "data_label": "MODEL_PREDICTION"}


# ------------------------------------------------------------------ flood
@router.get("/flood/current", tags=["Flood"])
def flood_current(city: str | None = Q_CITY, t: float | None = Q_T):
    c, e, snap = resolve(city, t)
    g = e.flood_grid(snap["event_minute"], 0)
    return {**meta(snap, "SIMULATED_DATA", ["Coupled 1D-2D flood model driven by simulated rainfall"]), **g,
            "kpis": {k: snap["kpis"][k] for k in ("flooded_area_km2", "max_depth_m", "flooded_roads_now", "impassable_roads")}}


@router.get("/flood/forecast", tags=["Flood"])
def flood_forecast(horizon: int = Query(60, ge=0, le=180), city: str | None = Q_CITY, t: float | None = Q_T):
    c, e, snap = resolve(city, t)
    return {**meta(snap, "MODEL_PREDICTION", ["Nowcast-driven coupled flood forecast"]), **e.flood_grid(snap["event_minute"], horizon)}


@router.get("/flood/timeline", tags=["Flood"])
def flood_timeline(city: str | None = Q_CITY, t: float | None = Q_T, step: int = Query(15, ge=5, le=60)):
    c, e, snap = resolve(city, t)
    return {**meta(snap, "MODEL_PREDICTION", ["Coupled flood forecast NOW→+180 min"]),
            "grid": {"rows": e.w.n, "cols": e.w.n, "bbox": e.w.bbox}, "frames": e.propagation(snap["event_minute"], step)}


@router.get("/flood/roads", tags=["Flood"])
def flood_roads(city: str | None = Q_CITY, t: float | None = Q_T, min_risk: str | None = None, ward: str | None = None,
                q: str | None = None, limit: int = 500):
    from app.engines.risk import LEVELS
    c, e, snap = resolve(city, t)
    rs = snap["roads"]
    if min_risk:
        rs = [r for r in rs if LEVELS.index(r["risk_level"]) >= LEVELS.index(min_risk.upper())]
    if ward:
        rs = [r for r in rs if r["ward"].lower() == ward.lower()]
    if q:
        rs = [r for r in rs if q.lower() in r["name"].lower() or q.lower() == r["id"].lower()]
    rs = sorted(rs, key=lambda r: (-r["risk_score"]))[:limit]
    return {**meta(snap, "MODEL_PREDICTION", ["Street-level flood intelligence"]), "count": len(rs), "roads": rs}


@router.get("/flood/roads/{road_id}", tags=["Flood"])
def flood_road(road_id: str, city: str | None = Q_CITY, t: float | None = Q_T):
    c, e, snap = resolve(city, t)
    r = next((x for x in snap["roads"] if x["id"] == road_id.upper()), None)
    if not r:
        raise HTTPException(404, "Road not found")
    nc, fc = e.forecast(snap["event_minute"])
    rr = [x[0] for x in get_world(c).road(r["id"])["cells"]]
    cc = [x[1] for x in get_world(c).road(r["id"])["cells"]]
    series = [{"offset_min": k * 5, "depth_m": round(float(fc[k]["h"][rr, cc].max()), 3)} for k in range(37)]
    past = [{"event_minute": int(f["t"]), "depth_m": round(float(f["h"][rr, cc].max()), 3)} for f in e.frames[: snap["event_minute"] // 5 + 1]]
    return {**r, "forecast_series": series, "history": past}


@router.get("/flood/zones", tags=["Flood"])
def flood_zones(city: str | None = Q_CITY, t: float | None = Q_T, horizon: int = Query(0, ge=0, le=180)):
    c, e, snap = resolve(city, t)
    g = e.flood_grid(snap["event_minute"], horizon)
    return {**meta(snap, "MODEL_PREDICTION" if horizon else "SIMULATED_DATA", ["Connected-component flood zones"]),
            "horizon_min": horizon, "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": z["geometry"], "properties": {k: v for k, v in z.items() if k != "geometry"}} for z in g["zones"]]}


# ------------------------------------------------------------------ risk
@router.get("/risk", tags=["Risk"])
def risk(city: str | None = Q_CITY, t: float | None = Q_T):
    c, e, snap = resolve(city, t)
    return {**meta(snap, "MODEL_PREDICTION", ["Explainable weighted risk model", "ML susceptibility model", "UFVI"]),
            "city_level": snap["kpis"]["city_risk_level"], "counts": snap["kpis"]["risk_counts"], "wards": snap["wards"],
            "weights": WEIGHTS, "levels": {"LOW": "<0.35", "MODERATE": "0.35–0.48", "HIGH": "0.48–0.60", "VERY_HIGH": "0.60–0.72", "CRITICAL": "≥0.72"},
            "top_roads": sorted(snap["roads"], key=lambda r: -r["risk_score"])[:20]}


@router.get("/risk/vulnerability", tags=["Risk"])
def vulnerability(city: str | None = Q_CITY):
    c = (city or clock.city).lower()
    return {"city": c, "data_label": "MODEL_PREDICTION", "index": "Urban Flood Vulnerability Index (UFVI, 0–1)",
            "wards": vulnerability_index(c)}


@router.get("/risk/model", tags=["Risk"])
def risk_model(city: str | None = Q_CITY):
    c = (city or clock.city).lower()
    _, names, info = ml_model(c)
    return {"city": c, "model": "sklearn GradientBoostingClassifier (flood susceptibility)", "trained_on": "7 simulated storms × all roads (SIMULATED_DATA)",
            **info, "feature_importances": ml_importances(c), "explainable_weights": WEIGHTS}


@router.get("/risk/explain", tags=["Risk"])
def explain(kind: str, id: str, city: str | None = Q_CITY, t: float | None = Q_T):
    """Explainable AI: prediction, confidence, timestamp, data sources, contributing factors."""
    c, e, snap = resolve(city, t)
    kind = kind.lower()
    if kind == "road":
        r = next((x for x in snap["roads"] if x["id"] == id.upper()), None)
        if not r:
            raise HTTPException(404, "Road not found")
        return {"kind": "road", "id": r["id"], "name": r["name"], "prediction": {"risk_level": r["risk_level"], "risk_score": r["risk_score"],
                "depth_now_m": r["depth_now_m"], "depth_forecast_m": r["depth_forecast_m"], "probability": r["probability"],
                "time_to_flood_min": r["time_to_flood_min"]}, "confidence": r["confidence"], "ml_susceptibility": r["ml_susceptibility"],
                "factors": r["factors"], "explanation": r["explanation"], **meta(snap, "MODEL_PREDICTION",
                ["Simulated rainfall + nowcast", "DEM (DEMO)", "Land cover (DEMO)", "Drainage twin", "Historical catalogue (DEMO)"])}
    if kind == "ward":
        wd = next((x for x in snap["wards"] if x["name"].lower() == id.lower() or x["id"] == id.upper()), None)
        if not wd:
            raise HTTPException(404, "Ward not found")
        uf = next((v for v in vulnerability_index(c) if v["ward"] == wd["name"]), None)
        return {"kind": "ward", "id": wd["id"], "name": wd["name"], "prediction": {"alert_level": wd["alert_level"], "risk_level": wd["risk_level"],
                "max_depth_60_m": wd["max_depth_60_m"], "flood_probability_60": wd["flood_probability_60"]},
                "triggers": wd["triggers"], "vulnerability": uf, "confidence": snap["kpis"]["nowcast_confidence_60"],
                **meta(snap, "MODEL_PREDICTION", ["Early warning rules", "UFVI"])}
    if kind in ("drain", "junction", "node"):
        d = next((x for x in snap["drains"] if x["id"] == id.upper()), None)
        if not d:
            raise HTTPException(404, "Node not found")
        roads = [r for r in snap["roads"] if r["id"] in d["connected_roads"]]
        factors = [
            {"factor": "utilization", "label": "Inflow vs effective capacity", "value": d["utilization"]},
            {"factor": "blockage", "label": "Assumed blockage (SIMULATED)", "value": d["blockage"]},
            {"factor": "backflow", "label": "Backwater from downstream", "value": 1.0 if d["backflow"] else 0.0},
            {"factor": "surcharge", "label": "Manhole storage filled", "value": d["surcharge"]},
        ]
        return {"kind": "drain", "id": d["id"], "prediction": {"status": d["status"], "status_30": d["status_30"], "status_60": d["status_60"]},
                "factors": factors, "connected_roads": [{"id": r["id"], "name": r["name"], "risk_level": r["risk_level"]} for r in roads],
                "confidence": snap["kpis"]["nowcast_confidence_60"], **meta(snap, "MODEL_PREDICTION", ["Drainage digital twin"])}
    raise HTTPException(400, "kind must be road | ward | drain")


# ------------------------------------------------------------------ infrastructure
@router.get("/infrastructure", tags=["Infrastructure"])
def infrastructure(city: str | None = Q_CITY, t: float | None = Q_T, kind: str | None = None):
    c, e, snap = resolve(city, t)
    fs = snap["facilities"]
    if kind:
        fs = [f for f in fs if f["kind"] == kind]
    counts = {}
    for f in snap["facilities"]:
        counts.setdefault(f["kind"], {"total": 0, "affected": 0})
        counts[f["kind"]]["total"] += 1
        counts[f["kind"]]["affected"] += f["status"] != "OPERATIONAL"
    return {**meta(snap, "MODEL_PREDICTION", ["Facility locations: DEMO_DATA", "Flood + routing engines"]),
            "counts": counts, "facilities": fs}


@router.get("/infrastructure/{fid}", tags=["Infrastructure"])
def infrastructure_detail(fid: str, city: str | None = Q_CITY, t: float | None = Q_T):
    c, e, snap = resolve(city, t)
    f = next((x for x in snap["facilities"] if x["id"] == fid.upper()), None)
    if not f:
        raise HTTPException(404, "Facility not found")
    return f


# ------------------------------------------------------------------ alerts
@router.get("/alerts", tags=["Alerts"])
def alerts(city: str | None = Q_CITY, t: float | None = Q_T, level: str | None = None):
    c, e, snap = resolve(city, t)
    a = snap["alerts"]
    if level:
        a = [x for x in a if x["level"] == level.upper()]
    return {**meta(snap, "MODEL_PREDICTION", ["Early warning engine"]), "thresholds": alert_rules.get_thresholds(),
            "counts": snap["kpis"]["alert_counts"], "alerts": a, "wards": [{"name": w["name"], "alert_level": w["alert_level"],
                                                                             "center": w["center"]} for w in snap["wards"]]}


class ThresholdIn(BaseModel):
    thresholds: dict


@router.put("/alerts/thresholds", tags=["Alerts"])
def set_thresholds(body: ThresholdIn, user=Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER"))):
    th = alert_rules.set_thresholds(body.thresholds)
    for e in list(__import__("app.engines.hub", fromlist=["_engines"])._engines.values()):
        e._snap.clear()
    return th


@router.post("/alerts/thresholds/reset", tags=["Alerts"])
def reset_thresholds(user=Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER"))):
    th = alert_rules.reset_thresholds()
    for e in list(__import__("app.engines.hub", fromlist=["_engines"])._engines.values()):
        e._snap.clear()
    return th


class NotifyIn(BaseModel):
    channels: list[str] = ["WEB"]
    recipients: list[str] = []
    language: str = "en"


@router.post("/alerts/{alert_id}/notify", tags=["Alerts"])
async def notify(alert_id: str, body: NotifyIn, city: str | None = Q_CITY, user=Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER", "EMERGENCY_RESPONDER"))):
    from app.engines.ops import notifier
    c, e, snap = resolve(city, None)
    a = next((x for x in snap["alerts"] if x["id"] == alert_id), None)
    if not a:
        raise HTTPException(404, "Alert not found (alerts are regenerated each 5-min step)")
    msg = a["messages"].get(body.language, a["messages"]["en"])
    out = []
    for ch in body.channels:
        ch = ch.upper()
        if ch == "WEB":
            await clock.ws.broadcast({"type": "alert_broadcast", "alert": {"id": a["id"], "level": a["level"], "location": a["location"], **msg}})
            out.append(notifier.send("WEB", "all-connected-clients", msg["headline"], msg["action"]))
        else:
            for r in body.recipients or ["(no recipients configured)"]:
                out.append(notifier.send(ch, r, msg["headline"], msg["action"]))
    return {"alert_id": alert_id, "deliveries": out}


@router.get("/notifications/outbox", tags=["Alerts"])
def outbox(user=Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER"))):
    from app.engines.ops import notifier
    return [{**r, "body": r["body"] if "token" not in r["body"].lower() else "[redacted]"} for r in notifier.outbox]


# ------------------------------------------------------------------ map layers
@router.get("/map/static", tags=["Map"])
def map_static(city: str | None = Q_CITY):
    c = (city or clock.city).lower()
    w = get_world(c)
    return {
        "city": c, "name": w.meta["name"], "center": w.meta["center"], "bbox": w.bbox, "rows": w.n, "cols": w.n,
        "cell_m": round(w.cell_m, 1), "data_label": "DEMO_DATA",
        "wards": [{"id": x["id"], "name": x["name"], "center": x["center"]} for x in w.wards],
        "roads": [{"id": r["id"], "name": r["name"], "street": r["street"], "ward": r["ward"], "road_class": r["road_class"],
                   "coords": r["coords"], "underpass": r["underpass"], "from": r["from"], "to": r["to"]} for r in w.roads],
        "junctions": [{"id": n["id"], "lat": n["lat"], "lon": n["lon"], "ward": n["ward"], "elevation_m": n["elevation_m"]} for n in w.road_nodes],
        "drain_nodes": [{"id": d["id"], "kind": d["kind"], "lat": d["lat"], "lon": d["lon"], "ward": d["ward"]} for d in w.drain_nodes],
        "drain_edges": [{"id": e["id"], "from": e["from"], "to": e["to"], "coords": e["coords"], "diameter_m": e["diameter_m"],
                         "conduit": e["conduit"]} for e in w.drain_edges],
        "infrastructure": w.infrastructure, "cctv": w.cctv,
        "river_cells": [[int(r), int(cc)] for r, cc in np.argwhere(w.river_mask)],
    }


@router.get("/map/dynamic", tags=["Map"])
def map_dynamic(city: str | None = Q_CITY, t: float | None = Q_T, horizon: int = Query(0, ge=0, le=180)):
    c, e, snap = resolve(city, t)
    nc, fc = e.forecast(snap["event_minute"])
    k = min(horizon // 5, 36)
    rain = fc[k]["rain"] if k > 0 else e.scn.observed(snap["event_minute"])
    g = e.flood_grid(snap["event_minute"], horizon)
    base_cum = e.states[snap["event_minute"] // 5]["cumP"]
    cum_grid = base_cum + (np.sum([f["rain"] * 5 / 60 for f in fc[1: k + 1]], axis=0) if k > 0 else 0)

    def road_depth(r):
        if horizon == 0:
            return r["depth_now_m"]
        return r["depth_forecast_m"].get(horizon)
    roads = []
    w = get_world(c)
    for r in snap["roads"]:
        d = road_depth(r)
        if d is None:
            cells = w.road(r["id"])["cells"]
            d = round(float(max(fc[k]["h"][a, b] for a, b in cells)), 3)
        roads.append({"id": r["id"], "depth_m": d, "risk_level": r["risk_level"], "passability": r["passability"] if horizon == 0 else None,
                      "closed": r["closed"], "time_to_flood_min": r["time_to_flood_min"], "probability_60": r["probability"][60]})
    return {**meta(snap, "MODEL_PREDICTION" if horizon else "SIMULATED_DATA", ["Coupled flood engine"]), "horizon_min": horizon,
            "rain_cells": compact_grid(rain, 0.5, 1), "rain_accum_cells": compact_grid(cum_grid, 1.0, 1),
            "runoff_cells": compact_grid(fc[k]["runoff_rate"] / (w.cell_area / 1e4) * 1000, 1.0, 1),
            "depth_cells": g["depth_cells"], "probability_cells": g["probability_cells"], "zones": g["zones"],
            "roads": roads,
            "drains": [{"id": d_id, "status": fc[k]["states"].get(d_id, "NORMAL"), "utilization": fc[k]["util"].get(d_id, 0.0)}
                       for d_id in (x["id"] for x in snap["drains"])],
            "facilities": [{"id": f["id"], "status": f["status"], "risk_level": f["risk_level"]} for f in snap["facilities"]],
            "wards": [{"id": x["id"], "alert_level": x["alert_level"], "risk_level": x["risk_level"]} for x in snap["wards"]],
            "kpis": {"max_depth_m": g["max_depth_m"], "flooded_area_km2": g["flooded_area_km2"], "confidence": g["confidence"]}}
