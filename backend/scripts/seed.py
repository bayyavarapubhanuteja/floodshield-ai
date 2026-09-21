"""Seed script: roles, demo users, emergency contacts, GIS tables, historical catalogue,
demo citizen reports and incidents. Idempotent. Run: python -m scripts.seed"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.data.cities import CITIES
from app.models import (CitizenReport, DEMTile, DrainageEdge, DrainageNode, EmergencyContact, HistoricalFlood, Incident,
                        Infrastructure, LandCoverCell, Road, Role, User)

DEMO_USERS = [
    ("admin@floodshield.local", "System Administrator", "ADMIN", "IT & Command Center"),
    ("officer@floodshield.local", "Municipal Officer (Demo)", "MUNICIPAL_OFFICER", "Storm Water Drains"),
    ("responder@floodshield.local", "Emergency Responder (Demo)", "EMERGENCY_RESPONDER", "Fire & Rescue"),
    ("analyst@floodshield.local", "Flood Analyst (Demo)", "ANALYST", "Planning & Analytics"),
    ("citizen@floodshield.local", "Citizen User (Demo)", "CITIZEN", ""),
]

NATIONAL = [
    ("EMERGENCY", "National Emergency Response (ERSS)", "112", "Single emergency number — police, fire, ambulance", True, True, 1),
    ("POLICE", "Police", "100", "Police control room (routes to 112 in many states)", True, False, 2),
    ("FIRE", "Fire", "101", "Fire & rescue services", True, False, 3),
    ("AMBULANCE", "Ambulance (Emergency)", "108", "Emergency ambulance service (most states)", True, False, 4),
    ("AMBULANCE", "Medical / Ambulance", "102", "Maternal & child / patient transport ambulance (where applicable)", True, False, 5),
    ("DISASTER", "State Disaster Management / State EOC", "1070", "State Emergency Operations Centre (availability varies by state)", True, False, 6),
    ("DISASTER", "District Disaster Management / District EOC", "1077", "District control room (availability varies by district)", True, False, 7),
    ("DISASTER", "NDMA Helpline", "1078", "National Disaster Management Authority", True, False, 8),
    ("ROAD", "Road Accident Emergency", "1073", "Road accident emergency service", True, False, 9),
    ("ELECTRICITY", "Electricity Complaints", "1912", "Power outage / electrical hazard (DISCOM)", True, False, 10),
    ("CHILD", "Child Helpline", "1098", "CHILDLINE", True, False, 11),
    ("WOMEN", "Women Helpline", "181", "Women in distress (state-run)", True, False, 12),
    ("WOMEN", "Women Helpline (Police)", "1091", "Women police helpline", True, False, 13),
    ("RAILWAY", "Railway Assistance", "139", "Railway enquiry & assistance", True, False, 14),
]

LOCAL_TEMPLATES = [
    ("MUNICIPAL", "Municipal Corporation Control Room"),
    ("COLLECTORATE", "District Collectorate Control Room"),
    ("DISASTER", "District Disaster Management Authority (DDMA)"),
    ("HOSPITAL", "Nearest Government Hospital Casualty"),
    ("POLICE", "City Police Control Room"),
    ("FIRE", "City Fire Control Room"),
    ("TRAFFIC", "Traffic Police Control Room"),
    ("ELECTRICITY", "DISCOM Local Complaint Cell"),
]


def seed_if_empty(db: Session) -> None:
    if db.query(User).count() == 0:
        seed(db)
    if get_settings().demo_accounts:
        sync_demo_accounts(db)


def sync_demo_accounts(db: Session) -> None:
    """Keep the demo logins shown on the login page working (public demo deployments)."""
    for email, name, role, dept in DEMO_USERS:
        pw = "Admin@123" if role == "ADMIN" else "Demo@123"
        u = db.query(User).filter_by(email=email).first()
        if u is None:
            db.add(User(email=email, full_name=name, hashed_password=hash_password(pw), role=role, department=dept,
                        city=get_settings().default_city))
        elif not verify_password(pw, u.hashed_password) or u.role != role or not u.is_active:
            u.hashed_password, u.role, u.is_active = hash_password(pw), role, True
    db.commit()


def seed(db: Session, all_cities: bool = False) -> None:
    settings = get_settings()
    for name, desc in [("ADMIN", "Full access"), ("MUNICIPAL_OFFICER", "Operations, alerts, moderation"),
                       ("EMERGENCY_RESPONDER", "Routing, incidents"), ("ANALYST", "Analytics, simulation"), ("CITIZEN", "Public services")]:
        if not db.query(Role).filter_by(name=name).first():
            db.add(Role(name=name, description=desc, permissions=[]))
    for email, name, role, dept in DEMO_USERS:
        if not db.query(User).filter_by(email=email).first():
            pw = ("Admin@123" if settings.demo_accounts else settings.seed_admin_password) if role == "ADMIN" else "Demo@123"
            db.add(User(email=email, full_name=name, hashed_password=hash_password(pw), role=role, department=dept,
                        city=settings.default_city))
    if db.query(EmergencyContact).count() == 0:
        for cat, name, num, desc, ver, prim, order in NATIONAL:
            db.add(EmergencyContact(city="national", category=cat, name=name, number=num, description=desc, verified=ver,
                                    primary=prim, sort_order=order))
        for ck, cfg in CITIES.items():
            for k, (cat, name) in enumerate(LOCAL_TEMPLATES):
                db.add(EmergencyContact(city=ck, category=cat, name=f"{cfg['name']} — {name}", number="",
                                        description="NOT CONFIGURED — enter the verified local number in Settings / Emergency Center",
                                        verified=False, primary=False, sort_order=50 + k))
    db.commit()
    cities = list(CITIES) if all_cities else [settings.default_city]
    for c in cities:
        seed_city(db, c)
    seed_demo_activity(db, settings.default_city)


def seed_city(db: Session, city: str) -> None:
    from app.engines.historical import events
    from app.engines.world import get_world
    if db.query(Road).filter_by(city=city).first():
        return
    w = get_world(city)
    db.add(DEMTile(city=city, bbox=list(w.bbox), rows=w.n, cols=w.n, elevation=w.dem.round(2).tolist(),
                   source="Synthetic DEM (demo)", data_label="DEMO_DATA"))
    db.add(LandCoverCell(city=city, grid=w.landcover.tolist(), imperviousness=w.impervious.round(2).tolist(), source="Synthetic LULC (demo)"))
    for r in w.roads:
        db.add(Road(id=f"{city[:3]}-{r['id']}", city=city, name=r["name"], road_class=r["road_class"], length_m=r["length_m"],
                    elevation_m=r["elevation_m"], lanes=r["lanes"],
                    geom={"type": "LineString", "coordinates": [[p[1], p[0]] for p in r["coords"]]}))
    for d in w.drain_nodes:
        db.add(DrainageNode(id=f"{city[:3]}-{d['id']}", city=city, kind=d["kind"], lat=d["lat"], lon=d["lon"], elevation_m=d["elevation_m"],
                            invert_m=d["invert_m"], capacity_m3s=d["capacity_m3s"], connected_roads=d["connected_roads"],
                            geom={"type": "Point", "coordinates": [d["lon"], d["lat"]]}))
    for e in w.drain_edges:
        db.add(DrainageEdge(id=f"{city[:3]}-{e['id']}", city=city, from_node=e["from"], to_node=e["to"], length_m=e["length_m"],
                            diameter_m=e["diameter_m"], slope=e["slope"], roughness=e["roughness"], capacity_m3s=e["capacity_m3s"],
                            geom={"type": "LineString", "coordinates": [[p[1], p[0]] for p in e["coords"]]}))
    for f in w.infrastructure:
        db.add(Infrastructure(id=f"{city[:3]}-{f['id']}", city=city, kind=f["kind"], name=f["name"], lat=f["lat"], lon=f["lon"],
                              capacity=f["capacity"], geom={"type": "Point", "coordinates": [f["lon"], f["lat"]]}))
    for ev in events(city):
        db.add(HistoricalFlood(city=city, event_date=datetime.fromisoformat(ev["event_date"]), rainfall_mm=ev["rainfall_mm"],
                               peak_intensity_mm_hr=ev["peak_intensity_mm_hr"], max_depth_m=ev["max_depth_m"], duration_hr=ev["duration_hr"],
                               affected_roads=ev["affected_roads"], drainage_failures=ev["drainage_failures"], hotspots=ev["hotspots"],
                               source=ev["source"], data_label="DEMO_DATA"))
    db.commit()


def seed_demo_activity(db: Session, city: str) -> None:
    from app.engines.world import get_world
    if db.query(CitizenReport).filter_by(city=city).first():
        return
    w = get_world(city)
    citizen = db.query(User).filter_by(email="citizen@floodshield.local").first()
    low = sorted(w.road_nodes, key=lambda n: n["elevation_m"])[:6]
    conds = ["FLOODED", "WATERLOGGED", "IMPASSABLE", "WATERLOGGED", "BLOCKED", "PASSABLE"]
    stats = ["VERIFIED", "UNVERIFIED", "UNDER_REVIEW", "VERIFIED", "UNVERIFIED", "RESOLVED"]
    for k, n in enumerate(low):
        db.add(CitizenReport(city=city, user_id=citizen.id if citizen else None, lat=n["lat"] + 0.0004, lon=n["lon"] - 0.0003,
                             estimated_depth_cm=[35, 15, 60, 20, 10, 0][k], road_condition=conds[k], status=stats[k],
                             description=f"[DEMO REPORT] Water logging near {n['ward']} junction {n['id']}",
                             created_at=datetime.utcnow() - timedelta(minutes=10 * k)))
    officer = db.query(User).filter_by(email="officer@floodshield.local").first()
    n0 = low[0]
    db.add(Incident(incident_id=f"INC-{city[:3].upper()}-DEMO-0001", city=city, title="[DEMO] Underpass waterlogging reported",
                    location=f"{n0['ward']} — junction {n0['id']}", lat=n0["lat"], lon=n0["lon"], severity="HIGH",
                    department="Storm Water Drains", status="ACKNOWLEDGED", created_by=officer.id if officer else None,
                    recommended_actions=["Deploy dewatering pump", "Divert traffic"], affected_roads=[], affected_infrastructure=[],
                    notes=[{"at": datetime.utcnow().isoformat(), "by": "system", "text": "Seeded demo incident"}]))
    db.commit()


if __name__ == "__main__":
    from app.core.database import SessionLocal, init_db
    init_db()
    s = SessionLocal()
    try:
        seed(s, all_cities="--all-cities" in sys.argv)
        print("Seed complete.")
    finally:
        s.close()
