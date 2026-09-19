"""Engine-level tests: world, terrain, nowcast, coupled hydraulics, risk, alerts, routing,
what-if simulation and computer vision."""
import numpy as np
import pytest

from tests.conftest import CITY


# ------------------------------------------------------------------ world
def test_world_generation_is_deterministic():
    from app.engines.world import build_world, get_world
    a = build_world(CITY)
    b = get_world(CITY)
    assert np.array_equal(a.dem, b.dem)
    assert np.array_equal(a.landcover, b.landcover)
    assert [r["id"] for r in a.roads] == [r["id"] for r in b.roads]
    assert [(r["from"], r["to"]) for r in a.roads] == [(r["from"], r["to"]) for r in b.roads]
    assert [(e["id"], e["diameter_m"], e["capacity_m3s"]) for e in a.drain_edges] == \
           [(e["id"], e["diameter_m"], e["capacity_m3s"]) for e in b.drain_edges]
    assert [f["id"] for f in a.infrastructure] == [f["id"] for f in b.infrastructure]


def test_world_structure_is_consistent():
    from app.engines.world import get_world
    w = get_world(CITY)
    assert w.dem.shape == (w.n, w.n)
    s, west, n, e = w.bbox
    assert s < n and west < e
    assert len(w.roads) > 100 and len(w.drain_edges) > 100
    ids = {d["id"] for d in w.drain_nodes}
    for e_ in w.drain_edges:  # every conduit connects known nodes and has positive capacity
        assert e_["from"] in ids and e_["to"] in ids
        assert e_["capacity_m3s"] > 0 and e_["diameter_m"] > 0
    outfalls = [d for d in w.drain_nodes if d["kind"] == "outfall"]
    assert outfalls and all(d["downstream"] is None for d in outfalls)
    # the drainage forest is acyclic: following `downstream` from any node reaches an outfall
    idx = w.extras["drain_index"]
    for d in w.drain_nodes:
        cur, hops = d, 0
        while cur["downstream"] is not None:
            cur = idx[cur["downstream"]]
            hops += 1
            assert hops < 500
        assert cur["kind"] == "outfall"


# ------------------------------------------------------------------ terrain
def test_priority_flood_fills_sinks():
    from app.engines.terrain import D8, priority_flood
    dem = np.full((9, 9), 10.0)
    dem[:, 0] = 5.0                 # low western edge = outlet
    dem[4, 4] = 2.0                 # closed interior pit
    dem[3:6, 3:6] = np.minimum(dem[3:6, 3:6], 8.0)
    dem[4, 4] = 2.0
    filled = priority_flood(dem)
    assert np.all(filled >= dem - 1e-12)
    assert filled[4, 4] > 8.0       # pit raised to spill level
    n, m = filled.shape
    # no interior cell remains a strict local minimum (every cell can drain)
    for r in range(1, n - 1):
        for c in range(1, m - 1):
            nb = [filled[r + dr, c + dc] for dr, dc in D8]
            assert min(nb) < filled[r, c]


def test_flow_accumulation_conserves_cells():
    from app.engines.terrain import D8, d8_flow, flow_accumulation, priority_flood
    rng = np.random.default_rng(0)
    yy, xx = np.mgrid[0:20, 0:20]
    dem = 50 - 0.5 * xx - 0.2 * yy + rng.normal(0, 0.3, (20, 20))
    filled = priority_flood(dem)
    fd = d8_flow(filled, 30.0)
    acc = flow_accumulation(filled, fd)
    assert acc.min() >= 1
    n, m = acc.shape
    outlet_total = 0.0
    for r in range(n):
        for c in range(m):
            k = fd[r, c]
            if k < 0 or not (0 <= r + D8[k][0] < n and 0 <= c + D8[k][1] < m):
                outlet_total += acc[r, c]
    # every cell's unit contribution ends at exactly one outlet
    assert outlet_total == pytest.approx(n * m)


def test_terrain_summary_for_city():
    from app.engines.terrain import analyse, summary
    t = analyse(CITY)
    assert np.all(t["filled"] >= 0) and np.all(t["depression"] >= -1e-9)
    s = summary(CITY)
    assert s["data_label"] == "DEMO_DATA"
    assert s["stats"]["catchments"] >= 1
    assert s["stats"]["min_elevation_m"] < s["stats"]["max_elevation_m"]


# ------------------------------------------------------------------ rainfall nowcast
def test_nowcast_horizons_and_decreasing_confidence(eng):
    from app.engines.rainfall import HORIZONS, nowcast
    nc = nowcast(eng.scn, 60)
    hz = [h["horizon_min"] for h in nc["horizons"]]
    assert hz == HORIZONS == [15, 30, 45, 60, 90, 120, 180]
    conf = [h["confidence"] for h in nc["horizons"]]
    assert all(0.35 <= c <= 0.97 for c in conf)
    assert all(a >= b for a, b in zip(conf, conf[1:])), conf
    assert conf[0] > conf[-1]
    for h in nc["horizons"]:
        assert h["intensity_mm_hr"] >= 0
        assert h["p10_mm_hr"] <= h["p90_mm_hr"]
        assert 0 <= h["heavy_rain_probability"] <= 1
    acc = [h["accumulation_mm"] for h in nc["horizons"]]
    assert all(a <= b for a, b in zip(acc, acc[1:]))
    assert nc["storm_motion"]["estimated"] is True


def test_phase_correlation_recovers_shift():
    from app.engines.rainfall import phase_correlation
    yy, xx = np.mgrid[0:48, 0:48].astype(float)

    def storm(cy, cx):  # smooth convective cell + embedded core (rain-field-like, no wrap-around)
        return (60 * np.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / 72)
                + 20 * np.exp(-((yy - cy - 5) ** 2 + (xx - cx + 4) ** 2) / 18))
    for d in [(2, 3), (-3, 1), (0, 4)]:
        dy, dx = phase_correlation(storm(20, 18), storm(20 + d[0], 18 + d[1]))
        assert dy == pytest.approx(d[0], abs=0.8) and dx == pytest.approx(d[1], abs=0.8)
    assert phase_correlation(np.zeros((8, 8)), np.ones((8, 8))) == (0.0, 0.0)


def test_nowcast_storm_motion_direction(eng):
    """Demo storm drifts towards ESE (~113°); the estimated motion should agree within 30°."""
    from app.engines.rainfall import nowcast
    for t in (60, 120):
        d = nowcast(eng.scn, t)["storm_motion"]["direction_deg"]
        assert abs(d - 113) <= 30, (t, d)


# ------------------------------------------------------------------ coupled hydraulics
def test_hydro_depths_never_negative(eng):
    for f in eng.frames:
        assert float(f["h"].min()) >= 0.0
        assert np.isfinite(f["h"]).all()
    for s in eng.states:
        assert all(v >= -1e-9 for v in s["store"].values())


def test_drainage_states_progress_with_storm(eng):
    """Demo storm ramps 20→40→70→100→120 mm/hr: drainage moves from NORMAL towards OVERLOADED."""
    def counts(t):
        f = eng.frames[t // 5]
        states = [v for k, v in f["states"].items() if not k.startswith("OF")]
        return {s: states.count(s) for s in ("NORMAL", "HIGH_LOAD", "NEAR_CAPACITY", "OVERLOADED", "OVERFLOW")}, len(states)

    c5, n = counts(5)
    assert c5["NORMAL"] == n                          # light rain: everything normal
    failing = []
    for t in (5, 30, 60, 90, 120):
        c, _ = counts(t)
        failing.append(c["OVERLOADED"] + c["OVERFLOW"])
    assert all(a <= b for a, b in zip(failing, failing[1:])), failing
    c120, _ = counts(120)
    assert c120["OVERLOADED"] + c120["OVERFLOW"] > n / 2
    assert c120["NORMAL"] < c5["NORMAL"]
    rain = [eng.frames[t // 5]["rain_mean"] for t in (5, 30, 60, 90, 120)]
    assert all(a < b for a, b in zip(rain, rain[1:]))


def test_node_state_thresholds():
    from app.engines.hydro import node_state
    assert node_state(0.3, 0) == "NORMAL"
    assert node_state(0.65, 0) == "HIGH_LOAD"
    assert node_state(0.85, 0) == "NEAR_CAPACITY"
    assert node_state(1.2, 0) == "OVERLOADED"
    assert node_state(1.2, 5.0) == "OVERFLOW"


def test_zero_rain_produces_no_flood():
    from app.engines.hydro import CoupledModel, run_timeline
    m = CoupledModel(CITY)
    zero = np.zeros((m.w.n, m.w.n))
    frames, _ = run_timeline(m, lambda t: zero, 30)
    assert all(f["flooded_cells"] == 0 for f in frames)
    assert all(f["runoff_total_m3s"] == 0 for f in frames)


# ------------------------------------------------------------------ risk
def test_risk_levels_valid(snap90):
    from app.engines.risk import LEVELS
    assert snap90["kpis"]["city_risk_level"] in LEVELS
    for r in snap90["roads"]:
        assert r["risk_level"] in LEVELS
        assert 0 <= r["risk_score"] <= 1
        assert 0 <= r["ml_susceptibility"] <= 1
        assert sum(f["contribution_pct"] for f in r["factors"]) == pytest.approx(100, abs=1.0)
        assert all(0 <= p <= 1 for p in r["probability"].values())
    for wd in snap90["wards"]:
        assert wd["alert_level"] in ("GREEN", "YELLOW", "ORANGE", "RED")


def test_risk_level_cutoffs():
    from app.engines.risk import WEIGHTS, level_of, score_features
    assert sum(WEIGHTS.values()) == pytest.approx(1.0)
    assert level_of(0.1) == "LOW" and level_of(0.40) == "MODERATE" and level_of(0.55) == "HIGH"
    assert level_of(0.65) == "VERY_HIGH" and level_of(0.9) == "CRITICAL"
    assert score_features({k: 1.0 for k in WEIGHTS})["score"] == pytest.approx(1.0)


def test_vulnerability_index_range():
    from app.engines.risk import vulnerability_index
    v = vulnerability_index(CITY)
    assert len(v) == 16
    assert all(0 <= x["ufvi"] <= 1 for x in v)
    assert [x["ufvi"] for x in v] == sorted((x["ufvi"] for x in v), reverse=True)


# ------------------------------------------------------------------ alerts
def test_alert_evaluate_thresholds():
    from app.engines import alerts
    alerts.reset_thresholds()
    assert alerts.evaluate({"rainfall_mm_hr": 5, "flood_probability": 0.1, "depth_m": 0.0,
                            "time_to_flood_min": None, "drainage_utilization": 0.3})[0] == "GREEN"
    lvl, trig = alerts.evaluate({"rainfall_mm_hr": 35})
    assert lvl == "YELLOW" and trig[0]["metric"] == "rainfall_mm_hr"
    assert alerts.evaluate({"rainfall_mm_hr": 65})[0] == "ORANGE"
    assert alerts.evaluate({"depth_m": 0.55})[0] == "RED"
    assert alerts.evaluate({"drainage_utilization": 1.3})[0] == "ORANGE"
    # time-to-flood only counts when the flood is likely (probability >= 0.5)
    assert alerts.evaluate({"time_to_flood_min": 20, "flood_probability": 0.2})[0] == "GREEN"
    assert alerts.evaluate({"time_to_flood_min": 20, "flood_probability": 0.9})[0] == "RED"
    # worst metric wins
    lvl, trig = alerts.evaluate({"rainfall_mm_hr": 35, "depth_m": 0.35})
    assert lvl == "ORANGE" and {t["metric"] for t in trig} == {"rainfall_mm_hr", "depth_m"}


def test_alert_thresholds_configurable():
    from app.engines import alerts
    try:
        alerts.set_thresholds({"rainfall_mm_hr": {"YELLOW": 10}})
        assert alerts.evaluate({"rainfall_mm_hr": 12})[0] == "YELLOW"
    finally:
        alerts.reset_thresholds()
    assert alerts.evaluate({"rainfall_mm_hr": 12})[0] == "GREEN"


def test_citizen_messages_multilingual():
    from app.engines.alerts import citizen_message
    for lang in ("en", "hi", "te", "ta", "mr"):
        m = citizen_message("RED", lang, "Ameerpet")
        assert m["language"] == lang and "Ameerpet" in m["headline"] and m["action"]


# ------------------------------------------------------------------ routing
def test_routing_avoids_roads_deeper_than_mode_limit():
    import networkx as nx
    from app.engines import routing
    from app.engines.world import get_world
    w = get_world(CITY)
    a, b = w.road_nodes[0], w.road_nodes[-1]
    dry = {r["id"]: {"depth_now_m": 0.0, "depth_30_m": 0.0, "risk_level": "LOW"} for r in w.roads}
    base = routing.route(CITY, dry, (a["lat"], a["lon"]), (b["lat"], b["lon"]), "NORMAL")
    assert base["status"] == "OK"
    used = [s["road_id"] for s in base["recommended"]["segments"]]
    # flood every road of the dry shortest path with 0.25 m (> NORMAL 0.15, < AMBULANCE 0.30)
    wet = {k: dict(v) for k, v in dry.items()}
    for rid in used:
        wet[rid] = {"depth_now_m": 0.25, "depth_30_m": 0.25, "risk_level": "HIGH"}
    res = routing.route(CITY, wet, (a["lat"], a["lon"]), (b["lat"], b["lon"]), "NORMAL")
    assert res["status"] == "OK"
    segs = res["recommended"]["segments"]
    assert not set(s["road_id"] for s in segs) & set(used)
    assert all(s["depth_m"] <= routing.MODES["NORMAL"]["max_depth"] for s in segs)
    assert res["recommended"]["safe_for_mode"] is True
    assert res["shortest_ignoring_flood"]["unsafe_segments"] > 0
    assert "diverted" in res["message"]
    # an ambulance (0.30 m limit) may use the 0.25 m roads
    amb = routing.weighted_graph(CITY, wet, "AMBULANCE")
    assert any(d["id"] in used for _, _, d in amb.edges(data=True))
    # the NORMAL graph contains no edge deeper than its limit
    g = routing.weighted_graph(CITY, wet, "NORMAL")
    assert all(d["depth"] <= 0.15 for _, _, d in g.edges(data=True))
    assert isinstance(g, nx.Graph)


def test_routing_no_safe_route_when_everything_flooded():
    from app.engines import routing
    from app.engines.world import get_world
    w = get_world(CITY)
    a, b = w.road_nodes[0], w.road_nodes[-1]
    deep = {r["id"]: {"depth_now_m": 0.8, "depth_30_m": 0.8, "risk_level": "CRITICAL"} for r in w.roads}
    res = routing.route(CITY, deep, (a["lat"], a["lon"]), (b["lat"], b["lon"]), "AMBULANCE")
    assert res["status"] == "NO_SAFE_ROUTE" and res["recommended"] is None


def test_routing_on_live_snapshot(snap90):
    from app.engines import routing
    fac = snap90["facilities"]
    fire = next(f for f in fac if f["kind"] == "fire_station")
    hosp = next(f for f in fac if f["kind"] == "hospital")
    res = routing.route(CITY, snap90["road_state"], (fire["lat"], fire["lon"]), (hosp["lat"], hosp["lon"]), "AMBULANCE")
    if res["status"] == "OK":
        for s in res["recommended"]["segments"]:
            assert s["depth_m"] <= 0.30 + 1e-9
    with pytest.raises(ValueError):
        routing.route(CITY, snap90["road_state"], (fire["lat"], fire["lon"]), (hosp["lat"], hosp["lon"]), "HOVERCRAFT")


# ------------------------------------------------------------------ what-if
def test_whatif_blockage_30pct():
    from app.engines.simulation import run_whatif
    res = run_whatif(CITY, {"blockage_pct": 30})
    assert res["data_label"] == "SIMULATED_DATA"
    for k in ("baseline", "scenario", "delta", "headline", "route_comparison", "ward_changes"):
        assert k in res
    b, s, d = res["baseline"]["summary"], res["scenario"]["summary"], res["delta"]
    assert set(b) == set(s) == set(d)
    assert d["max_flood_extent_km2"] == pytest.approx(s["max_flood_extent_km2"] - b["max_flood_extent_km2"], abs=1e-3)
    # same rainfall in both runs: only the drainage condition changes
    assert b["total_rain_mm"] == s["total_rain_mm"]
    assert s["max_flood_extent_km2"] >= b["max_flood_extent_km2"]
    assert len(res["ward_changes"]) == 16


def test_whatif_defaults_equal_baseline():
    from app.engines.simulation import run_whatif
    res = run_whatif(CITY, {})
    assert all(v in (0, 0.0, None) for v in res["delta"].values()), res["delta"]


def test_whatif_heavier_rain_is_worse():
    from app.engines.simulation import run_whatif
    res = run_whatif(CITY, {"rainfall_intensity": 120, "duration_min": 120})
    b, s = res["baseline"]["summary"], res["scenario"]["summary"]
    assert s["max_flood_extent_km2"] > b["max_flood_extent_km2"]
    assert s["affected_roads"] >= b["affected_roads"]


# ------------------------------------------------------------------ vision
def test_vision_flooded_vs_dry_sample():
    from app.engines.vision import analyse_image_bytes, make_sample_image
    flooded = analyse_image_bytes(make_sample_image("flooded"))
    dry = analyse_image_bytes(make_sample_image("dry"))
    assert flooded["water_coverage_pct"] > dry["water_coverage_pct"]
    assert flooded["water_detected"] is True
    assert flooded["estimated_depth_m"] >= dry["estimated_depth_m"]
    for r in (flooded, dry):
        assert r["is_estimate"] is True and r["data_label"] == "USER_REPORTED_DATA"
        assert r["severity"] in ("LOW", "MODERATE", "HIGH", "CRITICAL")


def test_vision_rejects_garbage():
    from app.engines.vision import analyse_image_bytes
    with pytest.raises(ValueError):
        analyse_image_bytes(b"not an image")
