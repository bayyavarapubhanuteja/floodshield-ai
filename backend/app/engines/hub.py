"""Engine hub: one cached, fully-coupled snapshot per (city, 5-minute event step).

WEATHER/RADAR → NOWCAST → TERRAIN → RUNOFF → SURFACE FLOW → DRAINAGE → COUPLED FLOOD
→ STREET-LEVEL RISK → EARLY WARNING → ROUTING → INFRASTRUCTURE → MUNICIPAL RESPONSE

Every consumer (REST, WebSocket, Copilot, PDF reports, alerts) reads the same snapshot, so
all numbers across the platform are consistent.
"""
from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

import numpy as np
from scipy.ndimage import label
from shapely.geometry import box, mapping
from shapely.ops import unary_union

from app.engines import alerts as alert_rules
from app.engines import routing
from app.engines.hydro import FLOOD_DEPTH, CoupledModel, HydroParams, edge_flows, run_timeline
from app.engines.rainfall import HORIZONS, StormScenario, classify, nowcast
from app.engines.risk import (LEVELS, bump, cap, level_of, ml_probabilities, score_features, static_layers,
                              vulnerability_index, ward_history, road_vulnerability)
from app.engines.world import get_world

T_MAX = 360
ROAD_FLOOD = 0.15
STATE_RANK = {"NORMAL": 0, "HIGH_LOAD": 1, "NEAR_CAPACITY": 2, "OVERLOADED": 3, "OVERFLOW": 4}


def _phi(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def passability(d: float) -> str:
    if d < 0.05:
        return "PASSABLE"
    if d < 0.15:
        return "PASSABLE_WITH_CAUTION"
    if d < 0.30:
        return "UNSAFE_LIGHT_VEHICLES"
    if d < 0.50:
        return "EMERGENCY_VEHICLES_ONLY"
    return "IMPASSABLE"


def compact_grid(grid: np.ndarray, min_val: float, digits: int = 2) -> list[list]:
    idx = np.argwhere(grid >= min_val)
    return [[int(r), int(c), round(float(grid[r, c]), digits)] for r, c in idx]


class CityEngine:
    def __init__(self, city: str):
        self.city = city
        self.w = get_world(city)
        self.scn = StormScenario(city)
        self.model = CoupledModel(city)
        self.frames, self.states = run_timeline(self.model, self.scn.field, T_MAX, keep_states=True)
        self._snap: OrderedDict = OrderedDict()
        self._fc: OrderedDict = OrderedDict()
        self.lock = threading.Lock()
        self.closures: set[str] = set()
        self.event_start = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        self.road_nodes_map: dict[str, list[str]] = {}
        for nd in self.w.drain_nodes:
            for rid in nd["connected_roads"]:
                self.road_nodes_map.setdefault(rid, []).append(nd["id"])
        self.ward_idx = {wd["name"]: i for i, wd in enumerate(self.w.wards)}

    # ------------------------------------------------------------------ forecasting
    @staticmethod
    def t5(t: float) -> int:
        return int(min(max(round(float(t) / 5) * 5, 0), T_MAX - 180))

    def forecast(self, t5: int):
        if t5 in self._fc:
            return self._fc[t5]
        nc = nowcast(self.scn, t5)
        fields = nc["_fields"]

        def rain_fn(tt):
            k = int((tt - t5) // 5)
            return fields[min(max(k, 0), len(fields) - 1)]
        state = CoupledModel.copy_state(self.states[t5 // 5])
        frames, _ = run_timeline(self.model, rain_fn, t5 + 180, state=state)
        frames[0] = self.frames[t5 // 5]
        self._fc[t5] = (nc, frames)
        while len(self._fc) > 48:
            self._fc.popitem(last=False)
        return nc, frames

    def snapshot(self, t: float) -> dict:
        t5 = self.t5(t)
        with self.lock:
            if t5 in self._snap:
                self._snap.move_to_end(t5)
                return self._snap[t5]
            snap = self._build(t5)
            self._snap[t5] = snap
            while len(self._snap) > 40:
                self._snap.popitem(last=False)
            return snap

    # ------------------------------------------------------------------ build
    def _build(self, t5: int) -> dict:
        t0 = time.time()
        w = self.w
        now = self.frames[t5 // 5]
        nc, fc = self.forecast(t5)
        st = static_layers(self.city)
        hist = ward_history(self.city)
        conf = {h["horizon_min"]: h["confidence"] for h in nc["horizons"]}
        storm_peak = max([now["rain_mean"]] + [h["intensity_mm_hr"] for h in nc["horizons"]])
        ml_p = ml_probabilities(self.city, storm_peak)
        issued = self.event_start + timedelta(minutes=t5)

        # ------------------------------ street-level flood intelligence
        roads = []
        road_state = {}
        for road in w.roads:
            cells = road["cells"]
            rr = [c[0] for c in cells]
            cc = [c[1] for c in cells]
            series = [float(f["h"][rr, cc].max()) for f in fc]  # index k => +5k min
            d_now = series[0]
            depths = {h: round(series[h // 5], 3) for h in HORIZONS}
            probs = {}
            for h in HORIZONS:
                d = series[h // 5]
                sigma = 0.03 + 0.0009 * h + 0.2 * d * (1 - conf.get(h, 0.7))
                probs[h] = round(_phi((d - ROAD_FLOOD) / sigma), 3)
            ttf = 0 if d_now >= ROAD_FLOOD else next((k * 5 for k, d in enumerate(series) if d >= ROAD_FLOOD), None)
            duration = sum(5 for d in series if d >= ROAD_FLOOD)
            kmax = int(np.argmax(series))
            nodes = self.road_nodes_map.get(road["id"], [])
            util_now = max([now["util"].get(n, 0) for n in nodes] or [0])
            util_30 = max([fc[6]["util"].get(n, 0) for n in nodes] or [0])
            worst_state = max([now["states"].get(n, "NORMAL") for n in nodes] or ["NORMAL"], key=lambda s: STATE_RANK[s])
            blockage = max([self.model.blockage.get(n, 0) for n in nodes] or [0])
            rain_60 = float(np.mean([f["rain"][rr, cc].mean() for f in fc[1:13]]))
            acc_180 = float(sum(f["rain"][rr, cc].mean() * 5 / 60 for f in fc[1:]))
            d60max = max(series[:13])
            feats = {
                "predicted_depth": d60max / 0.6, "drainage_utilization": max(util_now, util_30) / 1.5,
                "rainfall_intensity": rain_60 / 120, "low_elevation": 1 - float(np.mean([st["elev_pct"][a, b] for a, b in cells])),
                "runoff": float(np.mean([now["cum_runoff_mm"][a, b] for a, b in cells])) / 150,
                "historical_flooding": hist.get(road["ward"], 0.0), "drain_blockage": blockage / 0.5,
                "flat_terrain": 1 - min(float(np.mean([st["slope"][a, b] for a, b in cells])) / 5, 1),
                "imperviousness": float(np.mean([w.impervious[a, b] for a, b in cells])), "rain_duration": acc_180 / 150,
                "road_vulnerability": road_vulnerability(road),
                "infrastructure_exposure": min(float(np.mean([st["exposure"][a, b] for a, b in cells])) / 3, 1),
            }
            sc = score_features(feats)
            lvl = level_of(sc["score"])
            if d_now >= 0.8:
                lvl = bump(lvl, "CRITICAL")
            elif d_now >= 0.5 or d60max >= 0.6:
                lvl = bump(lvl, "VERY_HIGH")
            elif d60max >= 0.3:
                lvl = bump(lvl, "HIGH")
            elif d60max >= 0.12:
                lvl = bump(lvl, "MODERATE")
            if max(series) < 0.05:
                lvl = cap(lvl, "MODERATE")   # physics model: no significant ponding within 3 h
            elif max(series) < ROAD_FLOOD:
                lvl = cap(lvl, "HIGH")
            top = sc["factors"][:3]
            expl = (f"{road['name']}: {d_now:.2f} m now; forecast {depths[60]:.2f} m at +60 min "
                    f"(flood probability {probs[60]*100:.0f}%). "
                    + ("Already flooded. " if ttf == 0 else f"Expected to flood in ~{ttf} min. " if ttf else "Not expected to flood within 3 h. ")
                    + "Main drivers: " + "; ".join(f"{f['label']} ({f['contribution_pct']:.0f}%)" for f in top)
                    + f". Connected drainage: {worst_state.replace('_', ' ')} ({util_now*100:.0f}% utilisation).")
            rec = {
                "id": road["id"], "name": road["name"], "street": road["street"], "ward": road["ward"],
                "road_class": road["road_class"], "underpass": road["underpass"], "coords": road["coords"],
                "length_m": road["length_m"], "elevation_m": road["elevation_m"],
                "depth_now_m": round(d_now, 3), "depth_forecast_m": depths, "probability": probs,
                "time_to_flood_min": ttf, "duration_min": duration, "max_depth_m": round(max(series), 3),
                "time_of_max_min": kmax * 5, "drainage_status": worst_state, "drainage_utilization": round(util_now, 3),
                "drain_nodes": nodes, "passability": passability(d_now), "passability_60": passability(depths[60]),
                "risk_score": sc["score"], "risk_level": lvl, "factors": sc["factors"], "confidence": conf.get(60, 0.7),
                "ml_susceptibility": round(ml_p.get(road["id"], 0.0), 3), "explanation": expl,
                "closed": road["id"] in self.closures or d_now >= 0.5,
                "data_label": "MODEL_PREDICTION",
            }
            roads.append(rec)
            road_state[road["id"]] = {"depth_now_m": d_now, "depth_30_m": series[6], "risk_level": lvl,
                                      "closed": road["id"] in self.closures}

        # ------------------------------ drainage digital twin
        f30, f60 = fc[6], fc[12]
        drains = []
        for nd in w.drain_nodes:
            k = nd["id"]
            drains.append({
                "id": k, "kind": nd["kind"], "lat": nd["lat"], "lon": nd["lon"], "ward": nd["ward"],
                "elevation_m": nd["elevation_m"], "invert_m": nd["invert_m"],
                "capacity_m3s": round(nd["capacity_m3s"], 3), "effective_capacity_m3s": round(self.model.pipe_cap[k], 3),
                "inflow_m3s": now["inflow"].get(k, 0.0), "outflow_m3s": now["outflow"].get(k, 0.0),
                "utilization": now["util"].get(k, 0.0), "status": now["states"].get(k, "NORMAL"),
                "overflow_m3": now["overflow_m3"].get(k, 0.0), "surcharge": now["storage"].get(k, 0.0),
                "backflow": k in now["backflow"], "blockage": round(self.model.blockage[k], 3),
                "blockage_label": "ASSUMED (SIMULATED maintenance-age model — no sensors)",
                "status_30": f30["states"].get(k, "NORMAL"), "status_60": f60["states"].get(k, "NORMAL"),
                "utilization_60": f60["util"].get(k, 0.0),
                "connected_roads": nd["connected_roads"], "downstream": nd["downstream"], "upstream": nd["upstream"],
                "days_since_cleaning": nd["days_since_cleaning"], "historical_failures": nd["historical_failures"],
                "catchment_m2": nd["catchment_m2"],
            })
        edges = edge_flows(self.model, now)
        non_out = [d for d in drains if d["kind"] != "outfall"]
        state_counts = {s: 0 for s in STATE_RANK}
        for d in non_out:
            state_counts[d["status"]] += 1

        # ------------------------------ wards: risk, alerts
        wards = []
        alerts = []
        ufvi = {v["ward"]: v for v in vulnerability_index(self.city)}
        facilities = self._infrastructure(road_state, roads, now, fc)
        for i, wd in enumerate(w.wards):
            name = wd["name"]
            mask = w.ward == i
            wr = [r for r in roads if r["ward"] == name]
            wn = [d for d in non_out if d["ward"] == name]
            rain_now = float(now["rain"][mask].mean())
            rain_60 = max(float(f["rain"][mask].mean()) for f in fc[1:13])
            prob60 = max([r["probability"][60] for r in wr] or [0])
            depth60 = max([max(r["depth_now_m"], r["depth_forecast_m"][60], r["depth_forecast_m"][30]) for r in wr] or [0])
            ttfs = [r["time_to_flood_min"] for r in wr if r["time_to_flood_min"] is not None and r["probability"][60] >= 0.5]
            ttf = min(ttfs) if ttfs else None
            util = float(np.percentile([max(d["utilization"], fc[6]["util"].get(d["id"], 0)) for d in wn], 75)) if wn else 0.0
            metrics = {"rainfall_mm_hr": round(rain_60, 1), "flood_probability": prob60, "depth_m": round(depth60, 2),
                       "time_to_flood_min": ttf, "drainage_utilization": round(util, 2)}
            level, triggers = alert_rules.evaluate(metrics)
            risk_lvls = [r["risk_level"] for r in wr]
            worst_risk = max(risk_lvls, key=lambda x: LEVELS.index(x)) if risk_lvls else "LOW"
            worst_road = max(wr, key=lambda r: (r["risk_score"], r["depth_forecast_m"][60])) if wr else None
            flooded_now = [r for r in wr if r["depth_now_m"] >= ROAD_FLOOD]
            flooded_60 = [r for r in wr if max(r["depth_forecast_m"][60], r["depth_forecast_m"][30], r["depth_now_m"]) >= ROAD_FLOOD]
            wfac = [f for f in facilities if f["ward"] == name and f["status"] != "OPERATIONAL"]
            ward_rec = {
                "id": wd["id"], "name": name, "center": wd["center"], "alert_level": level, "risk_level": worst_risk,
                "rain_now_mm_hr": round(rain_now, 1), "rain_60_max_mm_hr": round(rain_60, 1),
                "flood_probability_60": prob60, "max_depth_60_m": round(depth60, 2), "time_to_flood_min": ttf,
                "drainage_utilization": round(util, 2), "flooded_roads_now": len(flooded_now),
                "flooded_roads_60": len(flooded_60), "affected_facilities": len(wfac),
                "flooded_area_pct": round(float((now["h"][mask] >= FLOOD_DEPTH).mean() * 100), 1),
                "ufvi": ufvi.get(name, {}).get("ufvi"), "ufvi_class": ufvi.get(name, {}).get("class"),
                "metrics": metrics, "triggers": triggers,
            }
            wards.append(ward_rec)
            if level != "GREEN" and worst_road:
                mid = worst_road["coords"][len(worst_road["coords"]) // 2]
                loc = f"{name} — {worst_road['street']}"
                alerts.append({
                    "id": f"{self.city[:3].upper()}-{t5:03d}-{wd['id']}", "city": self.city, "level": level,
                    "title": f"{level} flood alert: {name}", "location": loc, "ward": name, "lat": mid[0], "lon": mid[1],
                    "expected_time_min": ttf, "expected_time": (issued + timedelta(minutes=ttf)).isoformat() if ttf is not None else None,
                    "expected_depth_m": round(depth60, 2), "flood_probability": prob60,
                    "affected_roads": [{"id": r["id"], "name": r["name"], "depth_60_m": r["depth_forecast_m"][60]} for r in
                                       sorted(flooded_60, key=lambda r: -r["depth_forecast_m"][60])[:6]],
                    "affected_infrastructure": [{"id": f["id"], "name": f["name"], "kind": f["kind"], "status": f["status"]} for f in wfac],
                    "recommended_actions": alert_rules.ACTIONS[level],
                    "messages": {lang: alert_rules.citizen_message(level, lang, loc) for lang in ("en", "hi", "te", "ta", "mr")},
                    "triggers": triggers, "confidence": conf.get(60, 0.7), "issued_at": issued.isoformat(),
                    "event_minute": t5, "data_label": "MODEL_PREDICTION",
                })
        alerts.sort(key=lambda a: -alert_rules.LEVELS.index(a["level"]))

        # ------------------------------ KPIs
        fc180 = nc["horizons"][-1]
        hr3 = next(h for h in nc["horizons"] if h["horizon_min"] == 180)
        risk_counts = {l: sum(1 for r in roads if r["risk_level"] == l) for l in LEVELS}
        worst_ward = max(wards, key=lambda x: (alert_rules.LEVELS.index(x["alert_level"]), x["max_depth_60_m"]))
        city_level = max((r["risk_level"] for r in roads), key=lambda x: LEVELS.index(x))
        critical_locs = sorted(roads, key=lambda r: (-LEVELS.index(r["risk_level"]), -r["risk_score"]))[:8]
        kpis = {
            "rain_now_mm_hr": round(now["rain_mean"], 1), "rain_now_max_mm_hr": round(float(now["rain"].max()), 1),
            "rain_category": classify(now["rain_mean"]), "rain_cum_mm": round(now["cum_rain_mm"], 1),
            "rain_3h_forecast_mm": hr3["accumulation_mm"],
            "rain_peak_forecast_mm_hr": max(h["intensity_mm_hr"] for h in nc["horizons"]),
            "city_risk_level": city_level, "risk_counts": risk_counts,
            "flooded_roads_now": sum(1 for r in roads if r["depth_now_m"] >= ROAD_FLOOD),
            "flooded_roads_60": sum(1 for r in roads if r["depth_forecast_m"][60] >= ROAD_FLOOD),
            "impassable_roads": sum(1 for r in roads if r["passability"] in ("IMPASSABLE", "EMERGENCY_VEHICLES_ONLY")),
            "total_roads": len(roads),
            "flooded_area_km2": round(now["flooded_area_km2"], 2), "max_depth_m": round(now["max_depth"], 2),
            "max_depth_60_m": round(float(fc[12]["max_depth"]), 2),
            "drainage_utilization_mean": round(float(np.mean([d["utilization"] for d in non_out])), 3),
            "drainage_state_counts": state_counts,
            "drainage_overloaded": state_counts["OVERLOADED"] + state_counts["OVERFLOW"],
            "active_alerts": len(alerts), "alert_counts": {l: sum(1 for a in alerts if a["level"] == l) for l in alert_rules.LEVELS},
            "affected_facilities": sum(1 for f in facilities if f["status"] != "OPERATIONAL"),
            "total_facilities": len(facilities), "worst_ward": worst_ward["name"], "worst_ward_level": worst_ward["alert_level"],
            "runoff_m3s": round(now["runoff_total_m3s"], 1), "nowcast_confidence_60": conf.get(60),
        }
        zones_now = self._zones(now["h"], "NOW")
        snap = {
            "city": self.city, "city_name": w.meta["name"], "event_minute": t5, "issued_at": issued.isoformat(),
            "event_start": self.event_start.isoformat(), "kpis": kpis, "nowcast": {k: v for k, v in nc.items() if not k.startswith("_")},
            "roads": roads, "drains": drains, "edges": edges, "wards": wards, "alerts": alerts, "facilities": facilities,
            "critical_locations": [{"id": r["id"], "name": r["name"], "risk_level": r["risk_level"], "depth_now_m": r["depth_now_m"],
                                    "depth_60_m": r["depth_forecast_m"][60], "time_to_flood_min": r["time_to_flood_min"],
                                    "coords": r["coords"][len(r["coords"]) // 2]} for r in critical_locs],
            "zones": zones_now, "road_state": road_state,
            "_now": now, "_fc": fc,
            "compute_ms": 0,
        }
        snap["compute_ms"] = round((time.time() - t0) * 1000)
        return snap

    # ------------------------------------------------------------------ infra
    def _infrastructure(self, road_state, roads, now, fc) -> list[dict]:
        w = self.w
        rindex = {r["id"]: r for r in roads}
        out = []
        tt_cache = {}
        for f in w.infrastructure:
            r, c = w.latlon_to_rc(f["lat"], f["lon"])
            site_now = float(now["h"][max(r - 1, 0): r + 2, max(c - 1, 0): c + 2].max())
            site_60 = float(max(fr["h"][max(r - 1, 0): r + 2, max(c - 1, 0): c + 2].max() for fr in fc[:13]))
            access = [rid for rid in (w.road_graph.edges(f["road_node"], data="id"))]
            access_ids = [a[2] for a in access]
            access_flooded = [rid for rid in access_ids if rindex[rid]["depth_now_m"] > 0.30]
            access_flooded_60 = [rid for rid in access_ids if rindex[rid]["depth_forecast_m"][60] > 0.30]
            tts = routing.travel_times_from(self.city, road_state, f["road_node"], "AMBULANCE")
            tt_cache[f["id"]] = tts
            reach = len(tts) / max(len(w.road_nodes), 1)
            if site_now >= 0.30:
                status = "FLOODED"
            elif reach < 0.3:
                status = "ISOLATED"
            elif access_flooded or site_now >= 0.15:
                status = "ACCESS_RESTRICTED"
            elif access_flooded_60 or site_60 >= 0.15:
                status = "AT_RISK"
            else:
                status = "OPERATIONAL"
            risk = {"FLOODED": "CRITICAL", "ISOLATED": "VERY_HIGH", "ACCESS_RESTRICTED": "HIGH", "AT_RISK": "MODERATE"}.get(status, "LOW")
            near = []
            for rd in roads:
                mid = rd["coords"][len(rd["coords"]) // 2]
                dist = math.hypot((mid[0] - f["lat"]) * 111320, (mid[1] - f["lon"]) * 111320 * math.cos(math.radians(f["lat"])))
                if dist <= 600 and max(rd["depth_now_m"], rd["depth_forecast_m"][60]) >= ROAD_FLOOD:
                    near.append({"id": rd["id"], "name": rd["name"], "depth_now_m": rd["depth_now_m"],
                                 "depth_60_m": rd["depth_forecast_m"][60], "distance_m": round(dist)})
            out.append({**{k: f[k] for k in ("id", "kind", "name", "lat", "lon", "ward", "capacity", "critical", "road_node")},
                        "site_depth_now_m": round(site_now, 3), "site_depth_60_m": round(site_60, 3), "status": status,
                        "risk_level": risk, "reachable_network_pct": round(reach * 100, 1),
                        "access_roads": access_ids, "access_roads_flooded": access_flooded,
                        "affected_roads": sorted(near, key=lambda x: x["distance_m"])[:8], "data_label": "MODEL_PREDICTION",
                        "facility_data_label": "DEMO_DATA"})
        # alternatives: nearest operational facility of the same kind (ambulance travel time)
        for f in out:
            if f["status"] == "OPERATIONAL":
                f["alternative"] = None
                continue
            tts = tt_cache.get(f["id"], {})
            best = None
            for g in out:
                if g["kind"] != f["kind"] or g["id"] == f["id"] or g["status"] in ("FLOODED", "ISOLATED"):
                    continue
                t_ = tts.get(g["road_node"])
                if t_ is not None and (best is None or t_ < best[0]):
                    best = (t_, g)
            if best:
                f["alternative"] = {"id": best[1]["id"], "name": best[1]["name"], "travel_time_min": round(best[0], 1),
                                    "status": best[1]["status"], "basis": "ambulance flood-safe travel time"}
            else:
                cands = [g for g in out if g["kind"] == f["kind"] and g["id"] != f["id"] and g["status"] not in ("FLOODED", "ISOLATED")]
                g = min(cands, key=lambda g: math.hypot(g["lat"] - f["lat"], g["lon"] - f["lon"])) if cands else None
                f["alternative"] = {"id": g["id"], "name": g["name"], "travel_time_min": None, "status": g["status"],
                                    "basis": "straight-line (facility access currently cut off)"} if g else None
        return out

    # ------------------------------------------------------------------ zones
    def _zones(self, h: np.ndarray, tag: str, prob: np.ndarray | None = None) -> list[dict]:
        w = self.w
        lab, n = label(h >= FLOOD_DEPTH)
        zones = []
        for k in range(1, n + 1):
            cells = np.argwhere(lab == k)
            if len(cells) < 2:
                continue
            polys = []
            for r, c in cells:
                (s, wl), (nl, e) = w.cell_bounds(int(r), int(c))
                polys.append(box(wl, s, e, nl))
            geom = unary_union(polys).simplify(1e-5)
            d = h[lab == k]
            rmax, cmax = cells[np.argmax(d)]
            ward = w.wards[int(w.ward[rmax, cmax])]["name"]
            mx = float(d.max())
            zones.append({"id": f"Z{tag}-{k}", "name": f"{ward} flood zone", "ward": ward, "geometry": mapping(geom),
                          "cells": int(len(cells)), "area_km2": round(len(cells) * w.cell_area / 1e6, 3),
                          "max_depth_m": round(mx, 2), "mean_depth_m": round(float(d.mean()), 2),
                          "probability": round(float(prob[lab == k].mean()), 2) if prob is not None else 1.0,
                          "risk_level": "CRITICAL" if mx >= 0.8 else "VERY_HIGH" if mx >= 0.5 else "HIGH" if mx >= 0.3 else "MODERATE"})
        return sorted(zones, key=lambda z: -z["max_depth_m"])

    # ------------------------------------------------------------------ public helpers
    def flood_grid(self, t: float, horizon: int = 0) -> dict:
        t5 = self.t5(t)
        nc, fc = self.forecast(t5)
        k = min(horizon // 5, len(fc) - 1)
        h = fc[k]["h"]
        conf = {x["horizon_min"]: x["confidence"] for x in nc["horizons"]}.get(horizon, 0.9 if horizon == 0 else 0.7)
        sigma = 0.03 + 0.0009 * horizon + 0.2 * h * (1 - conf)
        prob = 0.5 * (1 + np.vectorize(math.erf)((h - FLOOD_DEPTH) / (sigma * math.sqrt(2))))
        return {"horizon_min": horizon, "event_minute": t5 + horizon, "confidence": conf,
                "depth_cells": compact_grid(h, 0.02), "probability_cells": compact_grid(prob, 0.1),
                "zones": self._zones(h, f"H{horizon}", prob), "max_depth_m": round(float(h.max()), 2),
                "flooded_area_km2": round(float((h >= FLOOD_DEPTH).sum() * self.w.cell_area / 1e6), 2),
                "data_label": "MODEL_PREDICTION" if horizon > 0 else "SIMULATED_DATA"}

    def propagation(self, t: float, step: int = 15) -> list[dict]:
        t5 = self.t5(t)
        nc, fc = self.forecast(t5)
        out = []
        for k in range(0, 37, step // 5):
            f = fc[k]
            out.append({"offset_min": k * 5, "event_minute": t5 + k * 5, "cells": compact_grid(f["h"], 0.05),
                        "flooded_area_km2": round(f["flooded_area_km2"], 3), "max_depth_m": round(f["max_depth"], 2),
                        "rain_mm_hr": round(f["rain_mean"], 1),
                        "overloaded_nodes": sum(1 for s in f["states"].values() if s in ("OVERLOADED", "OVERFLOW")),
                        "label": "NOW" if k == 0 else f"+{k*5} min"})
        return out

    def history(self, t: float) -> list[dict]:
        t5 = self.t5(t)
        out = []
        for f in self.frames[: t5 // 5 + 1]:
            util = [v for k, v in f["util"].items() if not k.startswith("OF")]
            out.append({"event_minute": int(f["t"]), "rain_mm_hr": round(f["rain_mean"], 1), "cum_rain_mm": round(f["cum_rain_mm"], 1),
                        "runoff_m3s": round(f["runoff_total_m3s"], 1), "flooded_area_km2": round(f["flooded_area_km2"], 3),
                        "max_depth_m": round(f["max_depth"], 2), "drainage_util_mean": round(float(np.mean(util)), 3),
                        "overloaded_nodes": sum(1 for s in f["states"].values() if s in ("OVERLOADED", "OVERFLOW"))})
        return out


_engines: dict[str, CityEngine] = {}
_elock = threading.Lock()


def engine(city: str) -> CityEngine:
    city = city.lower()
    with _elock:
        if city not in _engines:
            _engines[city] = CityEngine(city)
        return _engines[city]


def public(snap: dict) -> dict:
    return {k: v for k, v in snap.items() if not k.startswith("_") and k != "road_state"}
