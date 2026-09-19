"""What-If Simulator: BASELINE vs SCENARIO with the same coupled engine."""
from __future__ import annotations

import numpy as np

from app.engines import routing
from app.engines.hydro import FLOOD_DEPTH, CoupledModel, HydroParams, run_timeline
from app.engines.rainfall import DEFAULT_PROFILE, StormScenario
from app.engines.risk import LEVELS
from app.engines.world import get_world

ROAD_FLOOD = 0.15


def _run(city: str, params: HydroParams, scn: StormScenario, horizon: int) -> dict:
    w = get_world(city)
    m = CoupledModel(city, params)
    frames, _ = run_timeline(m, scn.field, horizon)
    hmax = np.max([f["h"] for f in frames], axis=0)
    peak = max(frames, key=lambda f: f["flooded_cells"])
    road_depth = {r["id"]: float(max(hmax[a, b] for a, b in r["cells"])) for r in w.roads}
    affected = [rid for rid, d in road_depth.items() if d >= ROAD_FLOOD]
    failed = sorted({k for f in frames for k, s in f["states"].items() if s in ("OVERLOADED", "OVERFLOW") and not k.startswith("OF")})
    overflow = sorted({k for f in frames for k, s in f["states"].items() if s == "OVERFLOW"})
    infra = []
    for fac in w.infrastructure:
        r, c = w.latlon_to_rc(fac["lat"], fac["lon"])
        site = float(hmax[max(r - 1, 0): r + 2, max(c - 1, 0): c + 2].max())
        access = [e[2] for e in w.road_graph.edges(fac["road_node"], data="id")]
        cut = all(road_depth[a] > 0.3 for a in access) if access else False
        if site >= 0.15 or cut:
            infra.append({"id": fac["id"], "name": fac["name"], "kind": fac["kind"], "site_depth_m": round(site, 2),
                          "access_cut": cut})
    wards = {}
    for i, wd in enumerate(w.wards):
        mask = w.ward == i
        mx = float(hmax[mask].max())
        lvl = "CRITICAL" if mx >= 0.8 else "VERY_HIGH" if mx >= 0.5 else "HIGH" if mx >= 0.3 else "MODERATE" if mx >= 0.12 else "LOW"
        wards[wd["name"]] = {"max_depth_m": round(mx, 2), "flooded_pct": round(float((hmax[mask] >= FLOOD_DEPTH).mean() * 100), 1),
                             "risk_level": lvl}
    series = [{"t": int(f["t"]), "flooded_area_km2": round(f["flooded_area_km2"], 3), "max_depth_m": round(f["max_depth"], 2),
               "rain_mm_hr": round(f["rain_mean"], 1),
               "overloaded": sum(1 for s in f["states"].values() if s in ("OVERLOADED", "OVERFLOW"))} for f in frames]
    road_state = {rid: {"depth_now_m": d, "depth_30_m": d, "risk_level": "LOW"} for rid, d in road_depth.items()}
    road_cells = [([a for a, _ in r["cells"]], [b for _, b in r["cells"]]) for r in w.roads]
    flooded_per_frame = [sum(1 for rr, cc in road_cells if f["h"][rr, cc].max() >= ROAD_FLOOD) for f in frames]
    first = next((int(f["t"]) for f, n_ in zip(frames, flooded_per_frame) if n_ > 0), None)
    area_hours = sum(f["flooded_area_km2"] for f in frames) * 5 / 60
    return {"hmax": hmax, "road_depth": road_depth, "road_state": road_state, "summary": {
        "max_flood_extent_km2": round(peak["flooded_area_km2"], 3), "max_flooded_cells": peak["flooded_cells"],
        "max_depth_m": round(float(hmax.max()), 2), "affected_roads": len(affected),
        "drainage_failures": len(failed), "overflowing_nodes": len(overflow), "infrastructure_impacted": len(infra),
        "total_rain_mm": round(frames[-1]["cum_rain_mm"], 1),
        "peak_runoff_m3s": round(max(f["runoff_total_m3s"] for f in frames), 1),
        "first_road_flooding_min": first, "flooded_road_hours": round(sum(flooded_per_frame) * 5 / 60, 1),
        "flood_area_km2_hours": round(area_hours, 2)},
        "affected_road_ids": affected, "failed_nodes": failed, "infrastructure": infra, "wards": wards, "series": series}


def run_whatif(city: str, p: dict) -> dict:
    """p keys: rainfall_intensity (mm/hr, optional), rainfall_multiplier, duration_min, drainage_capacity_pct,
    blockage_pct (uniform, optional), imperviousness_delta_pct, initial_water_level_m, route_from, route_to."""
    w = get_world(city)
    duration = int(np.clip(p.get("duration_min", 180), 15, 300))
    horizon = int(min(duration + 60, 360))
    base_params = HydroParams()
    base_scn = StormScenario(city)
    intensity = p.get("rainfall_intensity")
    scn = StormScenario(city, fixed_intensity=float(intensity) if intensity else None,
                        multiplier=float(p.get("rainfall_multiplier", 1.0)), duration=duration,
                        profile=DEFAULT_PROFILE)
    bp = p.get("blockage_pct")
    sp = HydroParams(capacity_factor=float(p.get("drainage_capacity_pct", 100)) / 100,
                     blockage_pct=float(bp) if bp is not None else None,
                     imperviousness_delta=float(p.get("imperviousness_delta_pct", 0)) / 100,
                     tailwater_m=float(p.get("initial_water_level_m", 0.5)),
                     initial_depth_m=float(p.get("initial_surface_water_m", 0.0)))
    base = _run(city, base_params, base_scn, horizon)
    scen = _run(city, sp, scn, horizon)
    diff = scen["hmax"] - base["hmax"]
    cells = [[int(r), int(c), round(float(diff[r, c]), 2), round(float(scen["hmax"][r, c]), 2)]
             for r, c in np.argwhere((np.abs(diff) >= 0.05) | (scen["hmax"] >= FLOOD_DEPTH))]
    ward_changes = []
    for name, b in base["wards"].items():
        s = scen["wards"][name]
        ward_changes.append({"ward": name, "baseline": b, "scenario": s,
                             "change": LEVELS.index(s["risk_level"]) - LEVELS.index(b["risk_level"])})
    new_roads = sorted(set(scen["affected_road_ids"]) - set(base["affected_road_ids"]))
    # route comparison (default: first fire station -> first hospital)
    fire = next(f for f in w.infrastructure if f["kind"] == "fire_station")
    hosp = next(f for f in w.infrastructure if f["kind"] == "hospital")
    o = p.get("route_from") or [fire["lat"], fire["lon"]]
    d = p.get("route_to") or [hosp["lat"], hosp["lon"]]
    rb = routing.route(city, base["road_state"], tuple(o), tuple(d), "AMBULANCE")
    rs = routing.route(city, scen["road_state"], tuple(o), tuple(d), "AMBULANCE")

    def brief(r):
        rec = r.get("recommended")
        return {"status": r["status"], "time_min": rec["time_min"] if rec else None,
                "distance_km": rec["distance_km"] if rec else None, "coords": rec["coords"] if rec else [],
                "max_depth_m": rec["max_depth_m"] if rec else None}
    sb, ss = base["summary"], scen["summary"]
    delta = {k: (round(ss[k] - sb[k], 3) if ss[k] is not None and sb[k] is not None else None) for k in sb}
    headline = (f"Scenario vs baseline: flood extent {sb['max_flood_extent_km2']}→{ss['max_flood_extent_km2']} km², "
                f"max depth {sb['max_depth_m']}→{ss['max_depth_m']} m, affected roads {sb['affected_roads']}→{ss['affected_roads']}, "
                f"drainage failures {sb['drainage_failures']}→{ss['drainage_failures']}, "
                f"flooded road-hours {sb['flooded_road_hours']}→{ss['flooded_road_hours']}, "
                f"first road flooding at {sb['first_road_flooding_min']}→{ss['first_road_flooding_min']} min, "
                f"infrastructure impacted {sb['infrastructure_impacted']}→{ss['infrastructure_impacted']}.")
    return {
        "city": city, "params": p, "horizon_min": horizon, "data_label": "SIMULATED_DATA",
        "baseline": {"label": "BASELINE (demo storm, assumed network condition)", **{k: v for k, v in base.items() if k not in ("hmax", "road_depth", "road_state")}},
        "scenario": {"label": "SCENARIO", **{k: v for k, v in scen.items() if k not in ("hmax", "road_depth", "road_state")}},
        "delta": delta, "headline": headline, "diff_cells": cells, "ward_changes": ward_changes,
        "newly_affected_roads": [{"id": r, "name": w.road(r)["name"], "coords": w.road(r)["coords"]} for r in new_roads[:40]],
        "route_comparison": {"from": o, "to": d, "mode": "AMBULANCE", "baseline": brief(rb), "scenario": brief(rs),
                             "changed": brief(rb)["coords"] != brief(rs)["coords"]},
    }
