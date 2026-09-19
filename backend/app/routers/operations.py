"""Operational APIs: routing, nearest help, what-if simulation, citizen reports, CCTV / image
analysis, historical analytics, maintenance, emergency contacts, copilot, incidents, reports,
demo control, data quality, validation, audit and WebSocket."""
from __future__ import annotations

import csv
import io
import json
import os
import secrets
from datetime import datetime

from fastapi import (APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, WebSocket,
                     WebSocketDisconnect)
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import OFFICER_ROLES, get_current_user, get_optional_user, require_roles
from app.engines import copilot as copilot_engine
from app.engines import routing
from app.engines import vision
from app.engines.demo import clock
from app.engines.historical import analytics as hist_analytics
from app.engines.hub import engine
from app.engines.ops import data_quality, haversine_m, maintenance as maint_engine, validation as validation_engine
from app.engines.reports import build_pdf
from app.engines.simulation import run_whatif
from app.engines.world import get_world
from app.models import (AuditLog, CCTVEvent, CCTVFile, CitizenReport, EmergencyContact, Incident, MaintenanceRecommendation,
                        RouteRecord, Simulation, User)
from app.routers.situational import Q_CITY, Q_T, resolve

settings = get_settings()
router = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
public_router = APIRouter(prefix="/api")

IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/quicktime": ".mov", "video/x-msvideo": ".avi", "video/webm": ".webm"}


async def _save_upload(f: UploadFile, allowed: dict) -> tuple[str, bytes]:
    if f.content_type not in allowed:
        raise HTTPException(415, f"Unsupported type {f.content_type}. Allowed: {', '.join(allowed)}")
    data = await f.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "File too large")
    if not data:
        raise HTTPException(400, "Empty file")
    os.makedirs(settings.upload_dir, exist_ok=True)
    name = f"{datetime.utcnow():%Y%m%d%H%M%S}_{secrets.token_hex(8)}{allowed[f.content_type]}"  # never trust client filename
    path = os.path.join(settings.upload_dir, name)
    with open(path, "wb") as fh:
        fh.write(data)
    return name, data


# ------------------------------------------------------------------ system / demo
@public_router.get("/health", tags=["System"])
def health():
    from app.core.rate_limit import _redis
    return {"status": "ok", "app": settings.app_name, "version": settings.version, "tagline": settings.tagline,
            "database": settings.database_url.split(":")[0], "redis": "connected" if _redis is not None else "not configured (in-memory)",
            "clock": clock.status(), "hardware_dependencies": "NONE — software-only platform"}


@public_router.get("/demo", tags=["Demo"])
def demo_status():
    return clock.status()


class DemoIn(BaseModel):
    action: str = Field(description="START | PAUSE | RESET | FAST_DEMO | SEEK | SET_CITY")
    minute: float | None = None
    city: str | None = None


@router.post("/demo", tags=["Demo"])
async def demo_control(body: DemoIn, user: User = Depends(require_roles(*OFFICER_ROLES))):
    try:
        st = clock.control(body.action, body.minute, body.city)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))
    await clock.ws.broadcast({"type": "clock", **st})
    return st


@router.get("/data-quality", tags=["System"])
def dq(city: str | None = Q_CITY, check_live: bool = False, db: Session = Depends(get_db)):
    c, e, snap = resolve(city, None)
    n_rep = db.query(CitizenReport).filter(CitizenReport.city == c).count()
    n_med = db.query(CCTVFile).filter(CCTVFile.city == c).count()
    return data_quality(c, snap, n_rep, n_med, check_live)


@router.get("/validation", tags=["System"])
def validation(city: str | None = Q_CITY):
    return validation_engine((city or clock.city).lower())


@router.get("/audit-logs", tags=["System"])
def audit_logs(limit: int = 200, user: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000)).all()
    return [{"id": r.id, "user_id": r.user_id, "action": r.action, "resource": r.resource, "detail": r.detail, "ip": r.ip,
             "ts": r.ts.isoformat()} for r in rows]


@public_router.websocket("/ws")
async def ws(websocket: WebSocket):
    await clock.ws.connect(websocket)
    try:
        await websocket.send_json({"type": "hello", **clock.status()})
        while True:
            await websocket.receive_text()  # keepalive pings from client
    except WebSocketDisconnect:
        clock.ws.disconnect(websocket)
    except Exception:
        clock.ws.disconnect(websocket)


# ------------------------------------------------------------------ routing
class RouteIn(BaseModel):
    origin: list[float] = Field(min_length=2, max_length=2, description="[lat, lon]")
    destination: list[float] = Field(min_length=2, max_length=2)
    mode: str = "NORMAL"
    closures: list[str] = []
    city: str | None = None
    t: float | None = None


@router.get("/routes/modes", tags=["Routing"])
def route_modes():
    return routing.MODES


@router.post("/routes", tags=["Routing"])
def route(body: RouteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c, e, snap = resolve(body.city, body.t)
    try:
        res = routing.route(c, snap["road_state"], tuple(body.origin), tuple(body.destination), body.mode,
                            set(body.closures) | e.closures)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    db.add(RouteRecord(city=c, mode=body.mode.upper(), origin=body.origin, destination=body.destination,
                       result={"status": res["status"], "time": res["recommended"]["time_min"] if res.get("recommended") else None}))
    db.commit()
    return {"city": c, "event_minute": snap["event_minute"], **res}


class ClosureIn(BaseModel):
    road_id: str
    closed: bool = True


@router.post("/routes/closures", tags=["Routing"])
def closure(body: ClosureIn, city: str | None = Q_CITY, user: User = Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER", "EMERGENCY_RESPONDER")),
            db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    e = engine(c)
    rid = body.road_id.upper()
    if not get_world(c).road(rid):
        raise HTTPException(404, "Road not found")
    (e.closures.add if body.closed else e.closures.discard)(rid)
    e._snap.clear()
    audit(db, user.id, "ROAD_CLOSURE", f"road:{rid}", f"closed={body.closed}")
    return {"closures": sorted(e.closures)}


@router.get("/nearest-help", tags=["Emergency"])
def nearest_help(lat: float, lon: float, city: str | None = Q_CITY, kinds: str = "hospital,police,fire_station,shelter"):
    """Nearest reachable facilities from a user/map location using flood-safe routing."""
    c, e, snap = resolve(city, None)
    kinds_l = [k.strip() for k in kinds.split(",")]
    node = routing.nearest_node(c, lat, lon)
    out = {}
    for kind in kinds_l:
        mode = "AMBULANCE" if kind == "hospital" else "PEDESTRIAN" if kind == "shelter" else "EMERGENCY"
        tts = routing.travel_times_from(c, snap["road_state"], node, mode)
        cands = []
        for f in snap["facilities"]:
            if f["kind"] != kind:
                continue
            tt = tts.get(f["road_node"])
            cands.append({"id": f["id"], "name": f["name"], "lat": f["lat"], "lon": f["lon"], "status": f["status"],
                          "straight_line_m": round(haversine_m((lat, lon), (f["lat"], f["lon"]))),
                          "travel_time_min": round(tt, 1) if tt is not None else None, "reachable": tt is not None and f["status"] != "FLOODED"})
        cands.sort(key=lambda x: (not x["reachable"], x["travel_time_min"] if x["travel_time_min"] is not None else 1e9, x["straight_line_m"]))
        best = cands[0] if cands else None
        route = None
        if best and best["reachable"]:
            route = routing.route(c, snap["road_state"], (lat, lon), (best["lat"], best["lon"]), mode)
        out[kind] = {"mode": mode, "nearest": best, "options": cands[:4],
                     "route": {"coords": route["recommended"]["coords"], "time_min": route["recommended"]["time_min"],
                               "distance_km": route["recommended"]["distance_km"]} if route and route.get("recommended") else None}
    return {"city": c, "event_minute": snap["event_minute"], "origin": [lat, lon], "results": out,
            "emergency_number": "112", "data_label": "MODEL_PREDICTION", "facility_data_label": "DEMO_DATA"}


# ------------------------------------------------------------------ simulation
class SimIn(BaseModel):
    rainfall_intensity: float | None = Field(default=None, ge=0, le=400, description="Constant mm/hr (omit = demo storm profile)")
    rainfall_multiplier: float = Field(default=1.0, ge=0, le=5)
    duration_min: int = Field(default=180, ge=15, le=300)
    drainage_capacity_pct: float = Field(default=100, ge=10, le=200)
    blockage_pct: float | None = Field(default=None, ge=0, le=95, description="Uniform blockage (omit = assumed per-drain)")
    imperviousness_delta_pct: float = Field(default=0, ge=-30, le=30)
    initial_water_level_m: float = Field(default=0.5, ge=0, le=5, description="River/outfall tailwater level")
    initial_surface_water_m: float = Field(default=0.0, ge=0, le=0.5)
    route_from: list[float] | None = None
    route_to: list[float] | None = None
    city: str | None = None
    name: str | None = None
    save: bool = False


@router.post("/simulation", tags=["What-If Simulator"])
def simulate(body: SimIn, user: User = Depends(require_roles(*OFFICER_ROLES)), db: Session = Depends(get_db)):
    c = (body.city or clock.city).lower()
    p = body.model_dump(exclude={"city", "name", "save"})
    res = run_whatif(c, p)
    if body.save:
        s = Simulation(city=c, name=body.name or f"Scenario {datetime.utcnow():%Y-%m-%d %H:%M}", user_id=user.id, params=p,
                       result={k: res[k] for k in ("baseline", "scenario", "delta", "headline", "ward_changes", "route_comparison")})
        db.add(s)
        db.commit()
        res["saved_id"] = s.id
        audit(db, user.id, "SIMULATION_SAVE", f"simulation:{s.id}", res["headline"])
    return res


@router.get("/simulation", tags=["What-If Simulator"])
def list_sims(city: str | None = Q_CITY, db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    rows = db.query(Simulation).filter(Simulation.city == c).order_by(Simulation.id.desc()).limit(50).all()
    return [{"id": s.id, "name": s.name, "params": s.params, "headline": (s.result or {}).get("headline"),
             "created_at": s.created_at.isoformat()} for s in rows]


@router.get("/simulation/{sid}", tags=["What-If Simulator"])
def get_sim(sid: int, db: Session = Depends(get_db)):
    s = db.get(Simulation, sid)
    if not s:
        raise HTTPException(404, "Not found")
    return {"id": s.id, "name": s.name, "params": s.params, "result": s.result, "created_at": s.created_at.isoformat()}


@router.get("/simulation/{sid}/export", tags=["What-If Simulator"])
def export_sim(sid: int, fmt: str = "csv", db: Session = Depends(get_db)):
    s = db.get(Simulation, sid)
    if not s:
        raise HTTPException(404, "Not found")
    if fmt == "json":
        return Response(json.dumps({"name": s.name, "params": s.params, "result": s.result}, indent=2, default=str),
                        media_type="application/json", headers={"Content-Disposition": f"attachment; filename=scenario_{sid}.json"})
    buf = io.StringIO()
    wr = csv.writer(buf)
    wr.writerow(["metric", "baseline", "scenario", "delta"])
    b, sc, d = s.result["baseline"]["summary"], s.result["scenario"]["summary"], s.result["delta"]
    for k in b:
        wr.writerow([k, b[k], sc[k], d.get(k)])
    wr.writerow([])
    wr.writerow(["parameter", "value"])
    for k, v in s.params.items():
        wr.writerow([k, v])
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=scenario_{sid}.csv"})


# ------------------------------------------------------------------ citizen reports
def report_out(r: CitizenReport) -> dict:
    return {"id": r.id, "city": r.city, "lat": r.lat, "lon": r.lon, "estimated_depth_cm": r.estimated_depth_cm,
            "road_condition": r.road_condition, "description": r.description, "photo_url": f"/api/uploads/{r.photo_path}" if r.photo_path else None,
            "language": r.language, "status": r.status, "moderator_note": r.moderator_note, "image_analysis": r.image_analysis,
            "created_at": r.created_at.isoformat() if r.created_at else None, "user_id": r.user_id, "data_label": "USER_REPORTED_DATA"}


@router.post("/citizen-report", tags=["Citizen Reports"])
async def create_report(request: Request, lat: float = Form(...), lon: float = Form(...), estimated_depth_cm: float = Form(0, ge=0, le=300),
                        road_condition: str = Form("WATERLOGGED"), description: str = Form("", max_length=2000),
                        language: str = Form("en"), city: str | None = Form(None), photo: UploadFile | None = File(None),
                        user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    w = get_world(c)
    s, wl, n, e_ = w.bbox
    if not (s - 0.05 <= lat <= n + 0.05 and wl - 0.05 <= lon <= e_ + 0.05):
        raise HTTPException(400, "Location outside the city area")
    if road_condition.upper() not in ("PASSABLE", "WATERLOGGED", "FLOODED", "BLOCKED", "IMPASSABLE"):
        raise HTTPException(400, "Invalid road condition")
    path, analysis = None, None
    if photo is not None and photo.filename:
        path, data = await _save_upload(photo, IMAGE_TYPES)
        try:
            analysis = vision.analyse_image_bytes(data)
        except ValueError:
            analysis = None
    r = CitizenReport(city=c, user_id=user.id, lat=lat, lon=lon, estimated_depth_cm=estimated_depth_cm,
                      road_condition=road_condition.upper(), description=description, photo_path=path, language=language,
                      status="UNVERIFIED", image_analysis=analysis)
    db.add(r)
    db.commit()
    db.refresh(r)
    audit(db, user.id, "CITIZEN_REPORT", f"report:{r.id}", f"{lat},{lon}")
    out = report_out(r)
    await clock.ws.broadcast({"type": "citizen_report", "report": out})
    return out


@router.get("/citizen-report", tags=["Citizen Reports"])
def list_reports(city: str | None = Q_CITY, status: str | None = None, mine: bool = False,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    q = db.query(CitizenReport).filter(CitizenReport.city == c)
    if status:
        q = q.filter(CitizenReport.status == status.upper())
    if mine or user.role == "CITIZEN":
        # citizens see their own reports plus verified ones
        from sqlalchemy import or_
        q = q.filter(or_(CitizenReport.user_id == user.id, CitizenReport.status == "VERIFIED")) if not mine else q.filter(CitizenReport.user_id == user.id)
    snap = engine(c).snapshot(clock.minute)
    out = []
    for r in q.order_by(CitizenReport.id.desc()).limit(500).all():
        d = report_out(r)
        # cross-check against model: nearest road depth
        wr, wc = get_world(c).latlon_to_rc(r.lat, r.lon)
        d["model_depth_m"] = round(float(snap["_now"]["h"][max(wr - 1, 0): wr + 2, max(wc - 1, 0): wc + 2].max()), 2)
        d["model_agreement"] = ("AGREES" if abs(d["model_depth_m"] * 100 - r.estimated_depth_cm) <= 20
                                else "REPORT_HIGHER" if r.estimated_depth_cm > d["model_depth_m"] * 100 else "REPORT_LOWER")
        out.append(d)
    counts = {s: sum(1 for x in out if x["status"] == s) for s in ("VERIFIED", "UNVERIFIED", "UNDER_REVIEW", "RESOLVED")}
    return {"city": c, "counts": counts, "reports": out, "data_label": "USER_REPORTED_DATA"}


class ModerateIn(BaseModel):
    status: str
    note: str = ""


@router.patch("/citizen-report/{rid}", tags=["Citizen Reports"])
async def moderate(rid: int, body: ModerateIn, user: User = Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER", "EMERGENCY_RESPONDER")),
                   db: Session = Depends(get_db)):
    r = db.get(CitizenReport, rid)
    if not r:
        raise HTTPException(404, "Not found")
    st = body.status.upper().replace(" ", "_")
    if st not in ("VERIFIED", "UNVERIFIED", "UNDER_REVIEW", "RESOLVED"):
        raise HTTPException(400, "Invalid status")
    r.status, r.moderator_note = st, body.note
    db.commit()
    audit(db, user.id, "REPORT_MODERATE", f"report:{rid}", st)
    await clock.ws.broadcast({"type": "citizen_report", "report": report_out(r)})
    return report_out(r)


@public_router.get("/uploads/{name}", tags=["Citizen Reports"])
def get_upload(name: str):
    if "/" in name or ".." in name:
        raise HTTPException(400, "Bad name")
    path = os.path.join(settings.upload_dir, name)
    if not os.path.isfile(path):
        raise HTTPException(404, "Not found")
    return FileResponse(path)


# ------------------------------------------------------------------ vision
@router.post("/image-analysis", tags=["CCTV & Image Analysis"])
async def image_analysis(file: UploadFile = File(...), lat: float | None = Form(None), lon: float | None = Form(None),
                         camera_id: str | None = Form(None), city: str | None = Form(None),
                         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    name, data = await _save_upload(file, IMAGE_TYPES)
    try:
        res = vision.analyse_image_bytes(data)
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    if camera_id and lat is None:
        cam = next((x for x in get_world(c).cctv if x["id"] == camera_id), None)
        if cam:
            lat, lon = cam["lat"], cam["lon"]
    f = CCTVFile(city=c, filename=name, media_type="image", lat=lat, lon=lon, uploaded_by=user.id)
    db.add(f)
    db.commit()
    db.add(CCTVEvent(file_id=f.id, city=c, result=res))
    db.commit()
    return {"file_id": f.id, "file_url": f"/api/uploads/{name}", "lat": lat, "lon": lon, "camera_id": camera_id, **res}


@router.post("/video-analysis", tags=["CCTV & Image Analysis"])
async def video_analysis(file: UploadFile = File(...), lat: float | None = Form(None), lon: float | None = Form(None),
                         camera_id: str | None = Form(None), city: str | None = Form(None),
                         user: User = Depends(require_roles(*OFFICER_ROLES)), db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    name, _ = await _save_upload(file, VIDEO_TYPES)
    try:
        res = vision.analyse_video_file(os.path.join(settings.upload_dir, name))
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    if camera_id and lat is None:
        cam = next((x for x in get_world(c).cctv if x["id"] == camera_id), None)
        if cam:
            lat, lon = cam["lat"], cam["lon"]
    f = CCTVFile(city=c, filename=name, media_type="video", lat=lat, lon=lon, uploaded_by=user.id)
    db.add(f)
    db.commit()
    db.add(CCTVEvent(file_id=f.id, city=c, result=res))
    db.commit()
    return {"file_id": f.id, "lat": lat, "lon": lon, "camera_id": camera_id, **res}


@router.get("/cctv", tags=["CCTV & Image Analysis"])
def cctv(city: str | None = Q_CITY, db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    evs = (db.query(CCTVEvent, CCTVFile).join(CCTVFile, CCTVEvent.file_id == CCTVFile.id)
           .filter(CCTVEvent.city == c).order_by(CCTVEvent.id.desc()).limit(100).all())
    return {"city": c, "cameras": get_world(c).cctv,
            "note": "Analysis locations for uploaded or recorded footage — no live CCTV hardware integration.",
            "events": [{"id": ev.id, "file_id": f.id, "media_type": f.media_type, "file_url": f"/api/uploads/{f.filename}",
                        "lat": f.lat, "lon": f.lon, "ts": ev.ts.isoformat(),
                        "severity": ev.result.get("severity"), "estimated_depth_m": ev.result.get("estimated_depth_m", ev.result.get("max_estimated_depth_m")),
                        "result": ev.result} for ev, f in evs]}


@router.get("/cctv/sample", tags=["CCTV & Image Analysis"])
def cctv_sample(kind: str = "flooded"):
    """Synthetic sample street image (SIMULATED) for demonstrating the analysis pipeline."""
    return Response(vision.make_sample_image("flooded" if kind == "flooded" else "dry"), media_type="image/jpeg")


# ------------------------------------------------------------------ historical & maintenance
@router.get("/historical", tags=["Historical Analytics"])
def historical(city: str | None = Q_CITY):
    return hist_analytics((city or clock.city).lower())


@router.get("/maintenance", tags=["Drain Maintenance"])
def maintenance(city: str | None = Q_CITY, action: str | None = None, db: Session = Depends(get_db)):
    c, e, snap = resolve(city, None)
    recs = maint_engine(c, snap)
    status = {m.node_id: m.status for m in db.query(MaintenanceRecommendation).filter(MaintenanceRecommendation.city == c).all()}
    for r in recs:
        r["work_status"] = status.get(r["node_id"], "PENDING")
    if action:
        recs = [r for r in recs if r["action"] == action.upper()]
    counts = {a: sum(1 for r in maint_engine(c, snap) if r["action"] == a) for a in ("REPAIR", "CLEAN", "INSPECT", "MONITOR")}
    return {"city": c, "counts": counts, "recommendations": recs, "data_label": "MODEL_PREDICTION",
            "note": "No physical sensors: utilisation from simulation, blockage from maintenance-age assumptions."}


class WorkIn(BaseModel):
    status: str


@router.patch("/maintenance/{node_id}", tags=["Drain Maintenance"])
def maintenance_update(node_id: str, body: WorkIn, city: str | None = Q_CITY,
                       user: User = Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER")), db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    if body.status.upper() not in ("PENDING", "SCHEDULED", "IN_PROGRESS", "DONE"):
        raise HTTPException(400, "Invalid status")
    m = db.query(MaintenanceRecommendation).filter_by(city=c, node_id=node_id.upper()).first()
    if not m:
        m = MaintenanceRecommendation(city=c, node_id=node_id.upper(), action="", priority_score=0, reasons=[])
        db.add(m)
    m.status = body.status.upper()
    db.commit()
    audit(db, user.id, "MAINTENANCE_UPDATE", f"drain:{node_id}", m.status)
    return {"node_id": node_id.upper(), "status": m.status}


# ------------------------------------------------------------------ emergency contacts
def contact_out(x: EmergencyContact) -> dict:
    return {"id": x.id, "city": x.city, "category": x.category, "name": x.name, "number": x.number, "description": x.description,
            "verified": x.verified, "primary": x.primary, "sort_order": x.sort_order}


@public_router.get("/emergency-contacts", tags=["Emergency"])
def contacts(city: str | None = Q_CITY, db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    rows = db.query(EmergencyContact).filter(EmergencyContact.city.in_(["national", c])).order_by(
        EmergencyContact.primary.desc(), EmergencyContact.sort_order, EmergencyContact.id).all()
    return {"city": c, "primary": "112",
            "note": "National numbers are pan-India (some state services vary). Local numbers must be configured and verified by the municipality.",
            "contacts": [contact_out(x) for x in rows]}


class ContactIn(BaseModel):
    city: str
    category: str
    name: str = Field(max_length=160)
    number: str = Field(max_length=60)
    description: str = ""
    verified: bool = False
    sort_order: int = 100


@router.post("/emergency-contacts", tags=["Emergency"])
def add_contact(body: ContactIn, user: User = Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER")), db: Session = Depends(get_db)):
    x = EmergencyContact(**body.model_dump())
    db.add(x)
    db.commit()
    audit(db, user.id, "CONTACT_ADD", f"contact:{x.id}", body.name)
    return contact_out(x)


@router.put("/emergency-contacts/{cid}", tags=["Emergency"])
def edit_contact(cid: int, body: ContactIn, user: User = Depends(require_roles("ADMIN", "MUNICIPAL_OFFICER")), db: Session = Depends(get_db)):
    x = db.get(EmergencyContact, cid)
    if not x:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(x, k, v)
    db.commit()
    audit(db, user.id, "CONTACT_EDIT", f"contact:{cid}", body.name)
    return contact_out(x)


@router.delete("/emergency-contacts/{cid}", tags=["Emergency"])
def delete_contact(cid: int, user: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    x = db.get(EmergencyContact, cid)
    if not x:
        raise HTTPException(404, "Not found")
    if x.primary:
        raise HTTPException(400, "The primary emergency number cannot be deleted")
    db.delete(x)
    db.commit()
    audit(db, user.id, "CONTACT_DELETE", f"contact:{cid}")
    return {"ok": True}


# ------------------------------------------------------------------ copilot
class CopilotIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    city: str | None = None
    t: float | None = None


@router.post("/copilot", tags=["AI Copilot"])
def copilot(body: CopilotIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c, e, snap = resolve(body.city, body.t)
    res = copilot_engine.answer(body.question, snap, c)
    audit(db, user.id, "COPILOT_QUERY", "copilot", body.question[:200])
    return res


# ------------------------------------------------------------------ incidents
def incident_out(i: Incident) -> dict:
    return {"id": i.id, "incident_id": i.incident_id, "city": i.city, "title": i.title, "location": i.location, "lat": i.lat, "lon": i.lon,
            "severity": i.severity, "department": i.department, "affected_roads": i.affected_roads,
            "affected_infrastructure": i.affected_infrastructure, "recommended_actions": i.recommended_actions, "status": i.status,
            "notes": i.notes or [], "created_at": i.created_at.isoformat(), "updated_at": i.updated_at.isoformat() if i.updated_at else None}


class IncidentIn(BaseModel):
    title: str = Field(max_length=200)
    location: str = ""
    lat: float
    lon: float
    severity: str = "HIGH"
    department: str = "Municipal Engineering"
    affected_roads: list = []
    affected_infrastructure: list = []
    recommended_actions: list = []
    city: str | None = None


def _new_incident_id(db: Session, city: str) -> str:
    n = db.query(Incident).count() + 1
    return f"INC-{city[:3].upper()}-{datetime.utcnow():%y%m%d}-{n:04d}"


@router.get("/incidents", tags=["Incidents"])
def incidents(city: str | None = Q_CITY, status: str | None = None, db: Session = Depends(get_db)):
    c = (city or clock.city).lower()
    q = db.query(Incident).filter(Incident.city == c)
    if status:
        q = q.filter(Incident.status == status.upper())
    rows = [incident_out(i) for i in q.order_by(Incident.id.desc()).all()]
    return {"city": c, "counts": {s: sum(1 for r in rows if r["status"] == s) for s in ("OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED")},
            "incidents": rows}


@router.post("/incidents", tags=["Incidents"])
def create_incident(body: IncidentIn, user: User = Depends(require_roles(*OFFICER_ROLES)), db: Session = Depends(get_db)):
    c = (body.city or clock.city).lower()
    i = Incident(incident_id=_new_incident_id(db, c), city=c, created_by=user.id, **body.model_dump(exclude={"city"}))
    db.add(i)
    db.commit()
    audit(db, user.id, "INCIDENT_CREATE", i.incident_id, body.title)
    return incident_out(i)


@router.post("/incidents/from-alert/{alert_id}", tags=["Incidents"])
def incident_from_alert(alert_id: str, city: str | None = Q_CITY, user: User = Depends(require_roles(*OFFICER_ROLES)),
                        db: Session = Depends(get_db)):
    c, e, snap = resolve(city, None)
    a = next((x for x in snap["alerts"] if x["id"] == alert_id), None)
    if not a:
        raise HTTPException(404, "Alert not found")
    sev = {"RED": "CRITICAL", "ORANGE": "HIGH", "YELLOW": "MODERATE"}.get(a["level"], "LOW")
    dept = "Disaster Response Force" if a["level"] == "RED" else "Municipal Engineering"
    i = Incident(incident_id=_new_incident_id(db, c), city=c, title=a["title"], location=a["location"], lat=a["lat"], lon=a["lon"],
                 severity=sev, department=dept, affected_roads=a["affected_roads"], affected_infrastructure=a["affected_infrastructure"],
                 recommended_actions=a["recommended_actions"]["authority"], created_by=user.id,
                 notes=[{"at": datetime.utcnow().isoformat(), "by": user.full_name, "text": f"Created from alert {alert_id}"}])
    db.add(i)
    db.commit()
    audit(db, user.id, "INCIDENT_FROM_ALERT", i.incident_id, alert_id)
    return incident_out(i)


class IncidentUpdate(BaseModel):
    status: str | None = None
    department: str | None = None
    severity: str | None = None
    note: str | None = None


@router.patch("/incidents/{iid}", tags=["Incidents"])
async def update_incident(iid: int, body: IncidentUpdate, user: User = Depends(require_roles(*OFFICER_ROLES)), db: Session = Depends(get_db)):
    i = db.get(Incident, iid)
    if not i:
        raise HTTPException(404, "Not found")
    if body.status:
        st = body.status.upper().replace(" ", "_")
        if st not in ("OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"):
            raise HTTPException(400, "Invalid status")
        i.status = st
    if body.department:
        i.department = body.department
    if body.severity:
        i.severity = body.severity.upper()
    notes = list(i.notes or [])
    notes.append({"at": datetime.utcnow().isoformat(), "by": user.full_name,
                  "text": body.note or f"Updated: {body.model_dump_json(exclude_none=True)}"})
    i.notes = notes
    db.commit()
    audit(db, user.id, "INCIDENT_UPDATE", i.incident_id, body.model_dump_json(exclude_none=True))
    await clock.ws.broadcast({"type": "incident", "incident": incident_out(i)})
    return incident_out(i)


# ------------------------------------------------------------------ reports
@router.get("/reports/incident.pdf", tags=["Reports"])
def incident_pdf(city: str | None = Q_CITY, t: float | None = Q_T, route_mode: str = "AMBULANCE",
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c, e, snap = resolve(city, t)
    w = get_world(c)
    fire = next(f for f in snap["facilities"] if f["kind"] == "fire_station")
    hosp = next((f for f in snap["facilities"] if f["kind"] == "hospital" and f["status"] != "FLOODED"), snap["facilities"][0])
    route = routing.route(c, snap["road_state"], (fire["lat"], fire["lon"]), (hosp["lat"], hosp["lon"]), route_mode)
    pdf = build_pdf(snap, route, e.propagation(snap["event_minute"], 30), validation_engine(c), user.full_name)
    audit(db, user.id, "REPORT_PDF", f"{c}@{snap['event_minute']}")
    fname = f"FloodShield_{w.meta['name']}_T{snap['event_minute']:03d}.pdf"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={fname}"})
