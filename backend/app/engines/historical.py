"""Historical flood catalogue.

No verified municipal flood archive ships with the platform, so this module builds a
DEMO reconstruction: a seeded catalogue of monsoon storms (2006–2025) whose flood
impacts are *computed by the coupled model* (so depth/roads/failures are physically
consistent). Every record is labelled DEMO_DATA. Replace with IMD / municipal records via
POST /api/historical/import (CSV) for real deployments.
"""
from __future__ import annotations

from datetime import datetime
from functools import lru_cache

import numpy as np

from app.engines.world import get_world


@lru_cache(maxsize=8)
def _impact_table(city: str) -> list[dict]:
    """Run the coupled model for a ladder of storm peaks -> impacts (interpolated later)."""
    from app.engines.hydro import CoupledModel, run_timeline, FLOOD_DEPTH
    from app.engines.rainfall import StormScenario
    w = get_world(city)
    out = []
    for peak in [15, 30, 45, 60, 80, 100, 130, 160]:
        prof = [(0, peak * 0.3), (45, peak), (100, peak * 0.4), (160, 0)]
        m = CoupledModel(city)
        frames, _ = run_timeline(m, StormScenario(city, profile=prof).field, 180)
        hmax = np.max([f["h"] for f in frames], axis=0)
        roads = [r["id"] for r in w.roads if max(hmax[a, b] for a, b in r["cells"]) >= 0.15]
        fails = len({k for f in frames for k, s in f["states"].items() if s in ("OVERLOADED", "OVERFLOW")})
        wards = {}
        for i, wd in enumerate(w.wards):
            wards[wd["name"]] = float((hmax[w.ward == i] >= FLOOD_DEPTH).mean())
        dur = sum(1 for f in frames if f["flooded_cells"] > 5) * 5 / 60
        out.append({"peak": peak, "max_depth": float(hmax.max()), "roads": roads, "failures": fails,
                    "ward_frac": wards, "duration_hr": dur, "total_mm": float(frames[-1]["cum_rain_mm"])})
    return out


@lru_cache(maxsize=8)
def events(city: str) -> list[dict]:
    w = get_world(city)
    table = _impact_table(city)
    rng = np.random.default_rng(w.meta["seed"] + 2024)
    months = w.meta["monsoon_months"]
    out = []
    eid = 1
    for year in range(2006, 2026):
        for _ in range(int(rng.integers(2, 6))):
            month = int(rng.choice(months))
            day = int(rng.integers(1, 28))
            peak = float(np.clip(rng.gamma(2.2, 22), 12, 170))
            # nearest simulated impact row
            row = min(table, key=lambda r: abs(r["peak"] - peak))
            scale = peak / row["peak"]
            hot = sorted(row["ward_frac"].items(), key=lambda x: -x[1])
            hotspots = [h for h, v in hot if v > 0.02][:5]
            n_roads = int(round(len(row["roads"]) * min(scale, 1.3)))
            out.append({
                "id": eid, "event_date": datetime(year, month, day).isoformat(), "year": year, "month": month,
                "rainfall_mm": round(row["total_mm"] * scale * float(rng.uniform(0.8, 1.4)), 1),
                "peak_intensity_mm_hr": round(peak, 1),
                "max_depth_m": round(row["max_depth"] * min(scale, 1.4), 2),
                "duration_hr": round(max(row["duration_hr"] * scale, 0.5), 1),
                "affected_roads": row["roads"][:n_roads], "affected_road_count": n_roads,
                "drainage_failures": int(round(row["failures"] * min(scale, 1.3))),
                "hotspots": hotspots, "data_label": "DEMO_DATA",
                "source": "Synthetic catalogue reconstructed with FloodShield coupled model (demo)",
            })
            eid += 1
    return out


@lru_cache(maxsize=8)
def ward_frequency(city: str) -> dict[str, float]:
    ev = events(city)
    w = get_world(city)
    counts = {wd["name"]: 0 for wd in w.wards}
    for e in ev:
        for h in e["hotspots"]:
            counts[h] = counts.get(h, 0) + 1
    mx = max(counts.values()) or 1
    return {k: v / mx for k, v in counts.items()}


def analytics(city: str) -> dict:
    ev = events(city)
    by_year: dict[int, dict] = {}
    by_month: dict[int, dict] = {}
    for e in ev:
        y = by_year.setdefault(e["year"], {"year": e["year"], "events": 0, "max_depth_m": 0, "rainfall_mm": 0})
        y["events"] += 1
        y["max_depth_m"] = max(y["max_depth_m"], e["max_depth_m"])
        y["rainfall_mm"] += e["rainfall_mm"]
        m = by_month.setdefault(e["month"], {"month": e["month"], "events": 0, "avg_peak": 0.0})
        m["events"] += 1
        m["avg_peak"] += e["peak_intensity_mm_hr"]
    for m in by_month.values():
        m["avg_peak"] = round(m["avg_peak"] / m["events"], 1)
    road_freq: dict[str, int] = {}
    for e in ev:
        for r in e["affected_roads"]:
            road_freq[r] = road_freq.get(r, 0) + 1
    w = get_world(city)
    top_roads = sorted(road_freq.items(), key=lambda x: -x[1])[:12]
    freq = ward_frequency(city)
    x = np.array([e["peak_intensity_mm_hr"] for e in ev])
    yv = np.array([e["max_depth_m"] for e in ev])
    coef = np.polyfit(x, yv, 1) if len(x) > 2 else [0, 0]
    corr = float(np.corrcoef(x, yv)[0, 1]) if len(x) > 2 else 0.0
    return {
        "city": city, "data_label": "DEMO_DATA",
        "note": "Synthetic historical catalogue for demonstration. Not real observed flood records.",
        "events": ev,
        "summary": {"total_events": len(ev), "years": f"{ev[0]['year']}–{ev[-1]['year']}" if ev else "",
                    "max_depth_m": round(float(yv.max()), 2) if len(yv) else 0,
                    "mean_duration_hr": round(float(np.mean([e['duration_hr'] for e in ev])), 1) if ev else 0,
                    "total_drainage_failures": int(sum(e["drainage_failures"] for e in ev))},
        "by_year": sorted(by_year.values(), key=lambda v: v["year"]),
        "by_month": sorted(by_month.values(), key=lambda v: v["month"]),
        "rain_depth_relation": {"slope_m_per_mmhr": round(float(coef[0]), 4), "intercept_m": round(float(coef[1]), 3),
                                "correlation": round(corr, 3),
                                "points": [{"peak": e["peak_intensity_mm_hr"], "depth": e["max_depth_m"]} for e in ev]},
        "hotspot_wards": [{"ward": k, "frequency": round(v, 3)} for k, v in sorted(freq.items(), key=lambda x: -x[1])],
        "frequent_roads": [{"road_id": r, "name": w.road(r)["name"] if w.road(r) else r, "events": c,
                            "coords": w.road(r)["coords"] if w.road(r) else []} for r, c in top_roads],
    }
