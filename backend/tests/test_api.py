"""HTTP API tests (FastAPI TestClient against a temporary SQLite database)."""
import uuid

import pytest

from tests.conftest import CITY

JUDGE_QUESTIONS = [
    ("Which areas will flood in the next hour?", "flood_next"),
    ("Why is this junction high risk?", "why"),
    ("Which roads will become unsafe?", "unsafe_roads"),
    ("Which hospitals are affected?", "hospitals"),
    ("Which drains are overloaded?", "drains"),
    ("What happens at 120 mm/hr?", "whatif_rain"),
    ("What happens with 30% drainage blockage?", "whatif_blockage"),
    ("Generate a response summary", "summary"),
]


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.com"


# ------------------------------------------------------------------ system / public
def test_health_and_public_endpoints(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["database"] == "sqlite"
    assert "NONE" in body["hardware_dependencies"]
    assert client.get("/api/cities").status_code == 200
    r = client.get("/api/alerts/public", params={"lang": "hi"})
    assert r.status_code == 200 and "alerts" in r.json()


def test_emergency_contacts_public_with_112_primary(client):
    r = client.get("/api/emergency-contacts")  # no token
    assert r.status_code == 200
    body = r.json()
    assert body["primary"] == "112"
    first = body["contacts"][0]
    assert first["number"] == "112" and first["primary"] is True and first["verified"] is True
    assert sum(1 for c in body["contacts"] if c["primary"]) == 1
    local = [c for c in body["contacts"] if c["city"] == CITY]
    assert local and all(c["verified"] is False for c in local)  # local numbers must be configured


# ------------------------------------------------------------------ auth
def test_login_and_me(client, auth):
    r = client.get("/api/auth/me", headers=auth("admin"))
    assert r.status_code == 200 and r.json()["role"] == "ADMIN"
    r = client.post("/api/auth/login", json={"email": "admin@floodshield.local", "password": "wrong-pass"})
    assert r.status_code == 401


def test_oauth2_token_endpoint(client):
    r = client.post("/api/auth/token", data={"username": "analyst@floodshield.local", "password": "Demo@123"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "ANALYST"


@pytest.mark.parametrize("path", ["/api/dashboard", "/api/drains", "/api/flood/roads", "/api/auth/me", "/api/validation"])
def test_401_without_token(client, path):
    assert client.get(path).status_code == 401


def test_401_with_bad_token(client):
    assert client.get("/api/dashboard", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_refresh_token(client):
    r = client.post("/api/auth/login", json={"email": "responder@floodshield.local", "password": "Demo@123"})
    ref = r.json()["refresh_token"]
    r2 = client.post("/api/auth/refresh", json={"refresh_token": ref})
    assert r2.status_code == 200 and r2.json()["user"]["role"] == "EMERGENCY_RESPONDER"
    # an access token is not accepted as a refresh token (and vice versa)
    assert client.post("/api/auth/refresh", json={"refresh_token": r.json()["access_token"]}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {ref}"}).status_code == 401


def test_citizen_forbidden_on_simulation(client, auth):
    r = client.post("/api/simulation", json={"blockage_pct": 30}, headers=auth("citizen"))
    assert r.status_code == 403


def test_citizen_forbidden_on_officer_actions(client, auth):
    h = auth("citizen")
    assert client.post("/api/demo", json={"action": "START"}, headers=h).status_code == 403
    assert client.post("/api/incidents", json={"title": "x", "lat": 17.4, "lon": 78.47}, headers=h).status_code == 403
    assert client.get("/api/users", headers=h).status_code == 403
    assert client.get("/api/audit-logs", headers=auth("officer")).status_code == 403


def test_register_privileged_role_starts_as_citizen(client, auth):
    email = _email()
    r = client.post("/api/auth/register", json={"email": email, "full_name": "New Officer", "password": "Passw0rd!",
                                                "role": "MUNICIPAL_OFFICER"})
    assert r.status_code == 201, r.text
    u = r.json()["user"]
    assert u["role"] == "CITIZEN" and u["requested_role"] == "MUNICIPAL_OFFICER"
    # the new account cannot run simulations until an admin approves the role
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.post("/api/simulation", json={}, headers=h).status_code == 403
    r = client.patch(f"/api/users/{u['id']}", json={"role": "MUNICIPAL_OFFICER"}, headers=auth("admin"))
    assert r.status_code == 200 and r.json()["role"] == "MUNICIPAL_OFFICER" and r.json()["requested_role"] is None


def test_register_validation(client):
    assert client.post("/api/auth/register", json={"email": _email(), "full_name": "X Y", "password": "Passw0rd!",
                                                   "role": "ADMIN"}).status_code == 400
    assert client.post("/api/auth/register", json={"email": _email(), "full_name": "X Y", "password": "short"}).status_code == 422
    email = _email()
    r = client.post("/api/auth/register", json={"email": email, "full_name": "Plain Citizen", "password": "Passw0rd!"})
    assert r.status_code == 201 and r.json()["user"]["requested_role"] is None
    r = client.post("/api/auth/register", json={"email": email.upper(), "full_name": "Dup", "password": "Passw0rd!"})
    assert r.status_code == 409


def test_forgot_and_reset_password(client):
    email = _email()
    assert client.post("/api/auth/register", json={"email": email, "full_name": "Reset Me", "password": "OldPassw0rd"}).status_code == 201
    r = client.post("/api/auth/forgot-password", json={"email": email})
    assert r.status_code == 200
    tok = r.json()["dev_reset_token"]  # development mode without SMTP exposes the token
    # unknown accounts get the same generic response (no enumeration) and no token
    r2 = client.post("/api/auth/forgot-password", json={"email": _email()})
    assert r2.status_code == 200 and "dev_reset_token" not in r2.json()
    assert client.post("/api/auth/reset-password", json={"token": "bogus", "new_password": "NewPassw0rd"}).status_code == 400
    r = client.post("/api/auth/reset-password", json={"token": tok, "new_password": "NewPassw0rd"})
    assert r.status_code == 200
    assert client.post("/api/auth/login", json={"email": email, "password": "OldPassw0rd"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": email, "password": "NewPassw0rd"}).status_code == 200
    # tokens are single-use
    assert client.post("/api/auth/reset-password", json={"token": tok, "new_password": "Another1pass"}).status_code == 400


def test_profile_update_and_language(client):
    email = _email()
    r = client.post("/api/auth/register", json={"email": email, "full_name": "Profile User", "password": "Passw0rd!"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.put("/api/auth/me", json={"language": "te", "theme": "light"}, headers=h)
    assert r.status_code == 200 and r.json()["language"] == "te"
    assert client.put("/api/auth/me", json={"language": "fr"}, headers=h).status_code == 400


# ------------------------------------------------------------------ situational APIs
def test_dashboard_and_layers(client, auth):
    h = auth("officer")
    r = client.get("/api/dashboard", params={"t": 90}, headers=h)
    assert r.status_code == 200
    d = r.json()
    assert d["event_minute"] == 90 and d["data_label"] == "MODEL_PREDICTION"
    assert d["kpis"]["drainage_overloaded"] > 0
    r = client.get("/api/rainfall/forecast", params={"t": 60, "horizon": 60}, headers=h)
    assert [x["horizon_min"] for x in r.json()["horizons"]] == [15, 30, 45, 60, 90, 120, 180]
    assert r.json()["grid_horizon_min"] == 60
    assert client.get("/api/terrain", headers=h).json()["data_label"] == "DEMO_DATA"
    assert client.get("/api/terrain/layer", params={"name": "slope"}, headers=h).status_code == 200
    assert client.get("/api/terrain/layer", params={"name": "nope"}, headers=h).status_code == 400
    r = client.get("/api/flood/forecast", params={"t": 90, "horizon": 60}, headers=h)
    assert r.status_code == 200 and r.json()["horizon_min"] == 60
    r = client.get("/api/flood/zones", params={"t": 90}, headers=h)
    assert r.json()["type"] == "FeatureCollection"
    r = client.get("/api/risk/explain", params={"kind": "ward", "id": "Ameerpet", "t": 90}, headers=h)
    assert r.status_code == 200 and r.json()["name"] == "Ameerpet"
    r = client.get("/api/map/dynamic", params={"t": 90, "horizon": 30}, headers=h)
    assert r.status_code == 200 and r.json()["horizon_min"] == 30


def test_routes_api(client, auth):
    h = auth("responder")
    static = client.get("/api/map/static", headers=h).json()
    a, b = static["junctions"][0], static["junctions"][-1]
    r = client.post("/api/routes", json={"origin": [a["lat"], a["lon"]], "destination": [b["lat"], b["lon"]],
                                         "mode": "AMBULANCE", "t": 90}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("OK", "NO_SAFE_ROUTE") and body["max_safe_depth_m"] == 0.30
    if body["status"] == "OK":
        assert all(s["depth_m"] <= 0.30 for s in body["recommended"]["segments"])
    r = client.post("/api/routes", json={"origin": [a["lat"], a["lon"]], "destination": [b["lat"], b["lon"]], "mode": "BOAT"},
                    headers=h)
    assert r.status_code == 400


# ------------------------------------------------------------------ what-if API
def test_simulation_api_blockage(client, auth):
    r = client.post("/api/simulation", json={"blockage_pct": 30, "save": True, "name": "30% blockage"}, headers=auth("analyst"))
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("baseline", "scenario", "delta", "headline"):
        assert k in body
    sid = body["saved_id"]
    r = client.get(f"/api/simulation/{sid}/export", params={"fmt": "csv"}, headers=auth("analyst"))
    assert r.status_code == 200 and r.text.startswith("metric,baseline,scenario,delta")


# ------------------------------------------------------------------ copilot
@pytest.mark.parametrize("question,intent", JUDGE_QUESTIONS)
def test_copilot_judge_questions(client, auth, snap90, question, intent):
    r = client.post("/api/copilot", json={"question": question, "t": 90}, headers=auth("officer"))
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["intent"] == intent
    assert a["grounded"] is True and a["event_minute"] == 90
    assert a["answer"].strip() and a["sources"] and a["data_labels"]
    k = snap90["kpis"]
    txt = a["answer"]
    if intent == "drains":
        sc = k["drainage_state_counts"]
        assert f"{sc['OVERFLOW']} overflowing, {sc['OVERLOADED']} overloaded" in txt
    elif intent == "hospitals":
        assert "of 6 hospitals affected" in txt and "DEMO_DATA" in a["data_labels"]
    elif intent == "unsafe_roads":
        n_unsafe = sum(1 for x in snap90["roads"] if x["passability_60"] not in ("PASSABLE", "PASSABLE_WITH_CAUTION"))
        assert txt.startswith(f"**{n_unsafe} road segment(s) unsafe by +60 min**")
    elif intent == "summary":
        assert f"{k['rain_now_mm_hr']} mm/hr now" in txt and "112" in txt
    elif intent == "why":
        top = max(snap90["roads"], key=lambda x: x["risk_score"])
        assert top["name"] in txt and "Contributing factors" in txt
    elif intent == "flood_next":
        assert "next 60 minutes" in txt
    elif intent in ("whatif_rain", "whatif_blockage"):
        assert "| Metric | Baseline | Scenario |" in txt
        assert a["data_labels"] == ["SIMULATED_DATA"]
        assert set(a["data"]["whatif"]) >= {"baseline", "scenario", "delta"}
        if intent == "whatif_rain":
            assert "120 mm/hr" in txt
        else:
            assert "30% drainage blockage" in txt


def test_copilot_unknown_question_returns_capabilities(client, auth):
    r = client.post("/api/copilot", json={"question": "What is the capital of France?", "t": 90}, headers=auth("citizen"))
    assert r.status_code == 200 and r.json()["intent"] == "help"


# ------------------------------------------------------------------ reports & validation
def test_incident_pdf(client, auth):
    r = client.get("/api/reports/incident.pdf", params={"t": 90}, headers=auth("officer"))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.content[:4] == b"%PDF"
    assert len(r.content) > 5000


def test_validation_endpoint(client, auth):
    r = client.get("/api/validation", headers=auth("analyst"))
    assert r.status_code == 200
    v = r.json()
    assert v["validation_type"] == "DEMO_VALIDATION"
    assert v["real_world_validation"]["status"] == "NOT_AVAILABLE"
    assert [x["horizon_min"] for x in v["rainfall"]] == [15, 30, 45, 60, 90, 120, 180]
    fe = v["flood_extent"]["by_horizon"]
    assert fe["30"]["f1"] >= fe["120"]["f1"]  # skill degrades with lead time


# ------------------------------------------------------------------ citizen reports & CCTV
def test_citizen_report_with_image(client, auth):
    from app.engines.vision import make_sample_image
    static = client.get("/api/map/static", headers=auth("citizen")).json()
    lat, lon = static["center"]
    r = client.post("/api/citizen-report", headers=auth("citizen"),
                    data={"lat": str(lat), "lon": str(lon), "estimated_depth_cm": "40", "road_condition": "FLOODED",
                          "description": "Knee-deep water near the junction", "language": "en"},
                    files={"photo": ("street.jpg", make_sample_image("flooded"), "image/jpeg")})
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["status"] == "UNVERIFIED" and rep["data_label"] == "USER_REPORTED_DATA"
    assert rep["image_analysis"]["water_detected"] is True
    assert rep["photo_url"].startswith("/api/uploads/")
    img = client.get(rep["photo_url"])
    assert img.status_code == 200 and img.content[:2] == b"\xff\xd8"
    mine = client.get("/api/citizen-report", params={"mine": True}, headers=auth("citizen")).json()
    assert any(x["id"] == rep["id"] for x in mine["reports"])
    assert all("model_agreement" in x for x in mine["reports"])
    # moderation is restricted
    assert client.patch(f"/api/citizen-report/{rep['id']}", json={"status": "VERIFIED"}, headers=auth("citizen")).status_code == 403
    r = client.patch(f"/api/citizen-report/{rep['id']}", json={"status": "VERIFIED", "note": "Confirmed"}, headers=auth("officer"))
    assert r.status_code == 200 and r.json()["status"] == "VERIFIED"


def test_citizen_report_rejects_bad_input(client, auth):
    h = auth("citizen")
    assert client.post("/api/citizen-report", headers=h, data={"lat": "0", "lon": "0"}).status_code == 400
    static = client.get("/api/map/static", headers=h).json()
    lat, lon = static["center"]
    r = client.post("/api/citizen-report", headers=h, data={"lat": str(lat), "lon": str(lon)},
                    files={"photo": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 415
    assert client.get("/api/uploads/..%2Fsecret").status_code in (400, 404)


def test_image_analysis_api(client, auth):
    from app.engines.vision import make_sample_image
    h = auth("officer")
    wet = client.post("/api/image-analysis", headers=h, data={"camera_id": "CAM01"},
                      files={"file": ("wet.jpg", make_sample_image("flooded"), "image/jpeg")}).json()
    dry = client.post("/api/image-analysis", headers=h,
                      files={"file": ("dry.jpg", make_sample_image("dry"), "image/jpeg")}).json()
    assert wet["water_coverage_pct"] > dry["water_coverage_pct"]
    assert wet["lat"] is not None  # located from the camera id
    assert client.get("/api/cctv", headers=h).json()["events"]
    assert client.get("/api/cctv/sample", params={"kind": "dry"}, headers=h).headers["content-type"] == "image/jpeg"


# ------------------------------------------------------------------ incidents
def test_incident_create_and_status_update(client, auth):
    h = auth("officer")
    r = client.post("/api/incidents", headers=h, json={"title": "Underpass flooded", "location": "Test junction",
                                                       "lat": 17.40, "lon": 78.47, "severity": "HIGH"})
    assert r.status_code == 200, r.text
    inc = r.json()
    assert inc["status"] == "OPEN" and inc["incident_id"].startswith("INC-HYD-")
    r = client.patch(f"/api/incidents/{inc['id']}", headers=auth("responder"),
                     json={"status": "in progress", "note": "Pump team dispatched"})
    assert r.status_code == 200
    upd = r.json()
    assert upd["status"] == "IN_PROGRESS" and upd["notes"][-1]["text"] == "Pump team dispatched"
    assert client.patch(f"/api/incidents/{inc['id']}", headers=h, json={"status": "DONE-ISH"}).status_code == 400
    lst = client.get("/api/incidents", headers=h).json()
    assert any(i["id"] == inc["id"] for i in lst["incidents"]) and lst["counts"]["IN_PROGRESS"] >= 1


def test_incident_from_alert(client, auth):
    h = auth("officer")
    alerts = client.get("/api/alerts", headers=h).json()["alerts"]
    if not alerts:
        pytest.skip("no active alerts at the current clock minute")
    r = client.post(f"/api/incidents/from-alert/{alerts[0]['id']}", headers=h)
    assert r.status_code == 200 and r.json()["recommended_actions"]


# ------------------------------------------------------------------ demo clock
def test_demo_control(client, auth):
    h = auth("officer")
    try:
        r = client.post("/api/demo", json={"action": "RESET"}, headers=h)
        assert r.status_code == 200 and r.json()["mode"] == "PAUSED" and r.json()["minute"] == 0
        r = client.post("/api/demo", json={"action": "START"}, headers=h)
        assert r.json()["mode"] == "RUNNING" and r.json()["speed_min_per_sec"] > 0
        r = client.post("/api/demo", json={"action": "PAUSE"}, headers=h)
        assert r.json()["mode"] == "PAUSED" and r.json()["speed_min_per_sec"] == 0
        r = client.post("/api/demo", json={"action": "FAST_DEMO"}, headers=h)
        st = r.json()
        assert st["mode"] == "FAST_DEMO" and st["end_minute"] == 180
        assert st["speed_min_per_sec"] == pytest.approx(180 / 150, abs=1e-3)  # 180 event-min in ~150 s
        r = client.post("/api/demo", json={"action": "SEEK", "minute": 75}, headers=h)
        assert r.json()["minute"] == 75
        assert client.get("/api/demo").json()["mode"] == "FAST_DEMO"
        assert client.post("/api/demo", json={"action": "EXPLODE"}, headers=h).status_code == 400
        assert client.post("/api/demo", json={"action": "SET_CITY", "city": "atlantis"}, headers=h).status_code == 400
    finally:
        r = client.post("/api/demo", json={"action": "RESET"}, headers=h)
    assert r.json()["mode"] == "PAUSED" and r.json()["minute"] == 0


# ------------------------------------------------------------------ misc operations
def test_maintenance_and_historical(client, auth):
    h = auth("officer")
    m = client.get("/api/maintenance", headers=h).json()
    assert m["recommendations"] and set(m["counts"]) == {"REPAIR", "CLEAN", "INSPECT", "MONITOR"}
    node = m["recommendations"][0]["node_id"]
    assert client.patch(f"/api/maintenance/{node}", json={"status": "SCHEDULED"}, headers=h).json()["status"] == "SCHEDULED"
    hist = client.get("/api/historical", headers=h).json()
    assert hist["data_label"] == "DEMO_DATA" and hist["summary"]["total_events"] > 0


def test_nearest_help_and_data_quality(client, auth):
    h = auth("citizen")
    static = client.get("/api/map/static", headers=h).json()
    lat, lon = static["center"]
    r = client.get("/api/nearest-help", params={"lat": lat, "lon": lon}, headers=h)
    assert r.status_code == 200 and r.json()["emergency_number"] == "112"
    dq = client.get("/api/data-quality", headers=h).json()
    live = next(s for s in dq["sources"] if s["type"] == "LIVE_DATA")
    assert live["status"] in ("DEGRADED", "OFFLINE")  # live weather disabled in tests
