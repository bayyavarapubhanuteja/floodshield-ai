"""Flood Risk Engine (explainable weighted model + ML susceptibility model) and the
Urban Flood Vulnerability Index (UFVI)."""
from __future__ import annotations

from functools import lru_cache

import networkx as nx
import numpy as np

from app.engines.terrain import analyse
from app.engines.world import get_world

LEVELS = ["LOW", "MODERATE", "HIGH", "VERY_HIGH", "CRITICAL"]
CUTS = [0.35, 0.48, 0.60, 0.72]

WEIGHTS = {
    "predicted_depth": 0.34, "drainage_utilization": 0.10, "rainfall_intensity": 0.08, "low_elevation": 0.10,
    "runoff": 0.07, "historical_flooding": 0.07, "drain_blockage": 0.05, "flat_terrain": 0.05,
    "imperviousness": 0.05, "rain_duration": 0.03, "road_vulnerability": 0.03, "infrastructure_exposure": 0.03,
}
FACTOR_TEXT = {
    "predicted_depth": "predicted water depth in the next 60 min",
    "drainage_utilization": "drainage network loading at connected manholes",
    "rainfall_intensity": "forecast rainfall intensity",
    "low_elevation": "low-lying terrain (elevation percentile)",
    "runoff": "accumulated surface runoff",
    "historical_flooding": "history of flooding in this ward",
    "drain_blockage": "assumed drain blockage (maintenance-age model)",
    "flat_terrain": "flat terrain that slows surface drainage",
    "imperviousness": "high impervious surface cover",
    "rain_duration": "long-duration accumulation",
    "road_vulnerability": "road vulnerability (underpass / low-class road)",
    "infrastructure_exposure": "critical facilities nearby",
}


def level_of(score: float) -> str:
    for i, c in enumerate(CUTS):
        if score < c:
            return LEVELS[i]
    return LEVELS[-1]


def bump(level: str, minimum: str) -> str:
    return LEVELS[max(LEVELS.index(level), LEVELS.index(minimum))]


def cap(level: str, maximum: str) -> str:
    return LEVELS[min(LEVELS.index(level), LEVELS.index(maximum))]


def score_features(f: dict) -> dict:
    contrib = {k: WEIGHTS[k] * float(np.clip(f.get(k, 0.0), 0, 1)) for k in WEIGHTS}
    score = sum(contrib.values())
    tot = max(score, 1e-9)
    factors = sorted(({"factor": k, "label": FACTOR_TEXT[k], "value": round(float(np.clip(f.get(k, 0), 0, 1)), 3),
                       "weight": WEIGHTS[k], "contribution_pct": round(v / tot * 100, 1)} for k, v in contrib.items()),
                     key=lambda x: -x["contribution_pct"])
    return {"score": round(score, 3), "factors": factors}


@lru_cache(maxsize=8)
def static_layers(city: str) -> dict:
    w = get_world(city)
    t = analyse(city)
    n = w.n
    elev_pct = (np.argsort(np.argsort(w.dem.ravel())) / (n * n)).reshape(n, n)
    exposure = np.zeros((n, n))
    radius = max(1, int(round(600 / w.cell_m)))
    for f in w.infrastructure:
        if not f.get("critical") and f["kind"] not in ("school", "shelter", "railway_station"):
            continue
        r, c = w.latlon_to_rc(f["lat"], f["lon"])
        exposure[max(r - radius, 0): r + radius + 1, max(c - radius, 0): c + radius + 1] += 1
    btw = nx.betweenness_centrality(w.road_graph, k=None, weight="length", normalized=True)
    return {"elev_pct": elev_pct, "slope": t["slope_pct"], "exposure": exposure, "betweenness": btw,
            "low_lying": t["low_lying"]}


def ward_history(city: str) -> dict[str, float]:
    from app.engines.historical import ward_frequency
    return ward_frequency(city)


def road_vulnerability(road: dict) -> float:
    if road.get("underpass"):
        return 1.0
    return {"local": 0.5, "collector": 0.35, "arterial": 0.2}.get(road["road_class"], 0.4)


@lru_cache(maxsize=8)
def ml_model(city: str):
    """GradientBoosting susceptibility classifier trained on simulated storms (not the demo storm).
    Label: road reaches ≥0.15 m during the storm. Features exclude any predicted depth."""
    from sklearn.ensemble import GradientBoostingClassifier
    from app.engines.hydro import CoupledModel, HydroParams, run_timeline
    from app.engines.rainfall import StormScenario
    w = get_world(city)
    st = static_layers(city)
    hist = ward_history(city)
    X, y = [], []
    rng = np.random.default_rng(w.meta["seed"] + 5)
    for k in range(7):
        peak = float(rng.uniform(30, 150))
        prof = [(0, peak * 0.2), (40, peak * 0.6), (80, peak), (140, peak * 0.5), (200, 0)]
        extra = float(rng.uniform(0, 30))
        m = CoupledModel(city, HydroParams(extra_blockage_pct=extra))
        scn = StormScenario(city, profile=prof)
        frames, _ = run_timeline(m, scn.field, 200)
        hmax = np.max([f["h"] for f in frames], axis=0)
        for road in w.roads:
            cells = road["cells"]
            feats = _static_road_features(w, st, hist, road)
            X.append([peak / 150, extra / 50] + feats)
            y.append(int(max(hmax[r, c] for r, c in cells) >= 0.15))
    X, y = np.array(X), np.array(y)
    clf = GradientBoostingClassifier(n_estimators=120, max_depth=3, learning_rate=0.08, random_state=0)
    clf.fit(X, y)
    names = ["storm_peak", "extra_blockage", "low_elevation", "flat_terrain", "imperviousness",
             "historical_flooding", "road_vulnerability", "infrastructure_exposure", "network_centrality"]
    acc = float(clf.score(X, y))
    return clf, names, {"train_samples": int(len(y)), "positive_rate": round(float(y.mean()), 3), "train_accuracy": round(acc, 3)}


def _static_road_features(w, st, hist, road) -> list[float]:
    cells = road["cells"]
    ep = float(np.mean([st["elev_pct"][r, c] for r, c in cells]))
    sl = float(np.mean([st["slope"][r, c] for r, c in cells]))
    imp = float(np.mean([w.impervious[r, c] for r, c in cells]))
    exp_ = float(np.mean([st["exposure"][r, c] for r, c in cells]))
    btw = (st["betweenness"].get(road["from"], 0) + st["betweenness"].get(road["to"], 0)) / 2
    return [1 - ep, 1 - min(sl / 5, 1), imp, hist.get(road["ward"], 0.0), road_vulnerability(road), min(exp_ / 3, 1), min(btw * 5, 1)]


def ml_probability(city: str, road: dict, storm_peak: float, extra_blockage: float) -> float:
    clf, _, _ = ml_model(city)
    w = get_world(city)
    x = [storm_peak / 150, extra_blockage / 50] + _static_road_features(w, static_layers(city), ward_history(city), road)
    return float(clf.predict_proba([x])[0][1])


def ml_probabilities(city: str, storm_peak: float, extra_blockage: float = 0.0) -> dict[str, float]:
    clf, _, _ = ml_model(city)
    w = get_world(city)
    st, hist = static_layers(city), ward_history(city)
    X = [[storm_peak / 150, extra_blockage / 50] + _static_road_features(w, st, hist, r) for r in w.roads]
    p = clf.predict_proba(np.array(X))[:, 1]
    return {r["id"]: float(v) for r, v in zip(w.roads, p)}


def ml_importances(city: str) -> list[dict]:
    clf, names, meta = ml_model(city)
    return [{"feature": n, "importance": round(float(v), 3)} for n, v in sorted(zip(names, clf.feature_importances_), key=lambda x: -x[1])]


@lru_cache(maxsize=8)
def vulnerability_index(city: str) -> list[dict]:
    """UFVI per ward: static composite of exposure & sensitivity (0–1)."""
    w = get_world(city)
    st = static_layers(city)
    hist = ward_history(city)
    out = []
    cap_by_ward: dict[str, float] = {}
    area_by_ward: dict[str, float] = {}
    for nd in w.drain_nodes:
        if nd["kind"] == "outfall":
            continue
        cap_by_ward[nd["ward"]] = cap_by_ward.get(nd["ward"], 0) + nd["capacity_m3s"] / max(len(nd["upstream"]) + 1, 1)
    for i, wd in enumerate(w.wards):
        m = w.ward == i
        area_by_ward[wd["name"]] = float(m.sum() * w.cell_area)
    design = {k: w.design_intensity * 0.8 * area_by_ward[k] / 3.6e6 for k in area_by_ward}
    for i, wd in enumerate(w.wards):
        m = w.ward == i
        name = wd["name"]
        deg = [n_ for n_ in w.road_nodes if n_["ward"] == name]
        btw = np.mean([st["betweenness"].get(n_["id"], 0) for n_ in deg]) if deg else 0
        comps = {
            "low_elevation": float(1 - st["elev_pct"][m].mean()),
            "flat_terrain": float(1 - min(st["slope"][m].mean() / 5, 1)),
            "imperviousness": float(w.impervious[m].mean()),
            "drainage_deficit": float(np.clip(1 - cap_by_ward.get(name, 0) / max(design[name], 1e-6), 0, 1)),
            "historical_flooding": float(hist.get(name, 0.0)),
            "infrastructure_exposure": float(min(st["exposure"][m].mean() / 2, 1)),
            "road_connectivity_criticality": float(min(btw * 8, 1)),
        }
        wts = {"low_elevation": 0.2, "flat_terrain": 0.1, "imperviousness": 0.15, "drainage_deficit": 0.2,
               "historical_flooding": 0.15, "infrastructure_exposure": 0.1, "road_connectivity_criticality": 0.1}
        v = sum(comps[k] * wts[k] for k in wts)
        cls = "VERY_HIGH" if v >= 0.6 else "HIGH" if v >= 0.48 else "MODERATE" if v >= 0.36 else "LOW"
        out.append({"ward": name, "ward_id": wd["id"], "center": wd["center"], "ufvi": round(v, 3), "class": cls,
                    "components": {k: round(val, 3) for k, val in comps.items()}, "weights": wts})
    return sorted(out, key=lambda x: -x["ufvi"])
