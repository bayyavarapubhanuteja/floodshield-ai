"""Flood-safe routing on the road GIS graph (NetworkX).

Edge cost = travel time (depth-reduced speed) x (1 + risk_weight x risk) ;
edges deeper than the mode's safe wading depth or manually closed are removed.
Depth used per edge = max(depth now, forecast depth at +30 min) so routes stay safe
for the duration of a typical trip.
"""
from __future__ import annotations

import itertools

import networkx as nx
from scipy.spatial import cKDTree

from app.engines.world import get_world

MODES = {
    "NORMAL": {"label": "Normal vehicle", "max_depth": 0.15, "speed_factor": 1.0, "risk_weight": 1.5},
    "AMBULANCE": {"label": "Ambulance", "max_depth": 0.30, "speed_factor": 1.25, "risk_weight": 0.8},
    "FIRE": {"label": "Fire tender", "max_depth": 0.60, "speed_factor": 1.1, "risk_weight": 0.6},
    "POLICE": {"label": "Police", "max_depth": 0.30, "speed_factor": 1.2, "risk_weight": 0.8},
    "EMERGENCY": {"label": "Emergency / high-clearance rescue", "max_depth": 0.45, "speed_factor": 1.15, "risk_weight": 0.7},
    "PUBLIC_TRANSPORT": {"label": "Bus / public transport", "max_depth": 0.30, "speed_factor": 0.8, "risk_weight": 1.2},
    "PEDESTRIAN": {"label": "Pedestrian", "max_depth": 0.10, "speed_factor": None, "risk_weight": 2.0},
}
RISK_NUM = {"LOW": 0.0, "MODERATE": 0.25, "HIGH": 0.5, "VERY_HIGH": 0.75, "CRITICAL": 1.0}


def nearest_node(city: str, lat: float, lon: float) -> str:
    w = get_world(city)
    tree = w.extras.get("_node_tree")
    if tree is None:
        tree = cKDTree([(n["lat"], n["lon"]) for n in w.road_nodes])
        w.extras["_node_tree"] = tree
    _, i = tree.query((lat, lon))
    return w.road_nodes[int(i)]["id"]


def weighted_graph(city: str, road_state: dict[str, dict], mode: str, closures: set[str] | None = None,
                   ignore_flood: bool = False) -> nx.Graph:
    w = get_world(city)
    cfg = MODES[mode]
    g = nx.Graph()
    closures = closures or set()
    for road in w.roads:
        st = road_state.get(road["id"], {})
        depth = max(st.get("depth_now_m", 0.0), st.get("depth_30_m", 0.0))
        risk = RISK_NUM.get(st.get("risk_level", "LOW"), 0)
        if not ignore_flood and (depth > cfg["max_depth"] or road["id"] in closures or st.get("closed")):
            continue
        speed = 5.0 if cfg["speed_factor"] is None else road["speed_kmh"] * cfg["speed_factor"]
        if not ignore_flood:
            speed *= max(0.25, 1 - 0.8 * depth / max(cfg["max_depth"], 0.05))
        tt = road["length_m"] / 1000 / speed * 60  # minutes
        cost = tt * (1 + (0 if ignore_flood else cfg["risk_weight"] * risk))
        g.add_edge(road["from"], road["to"], id=road["id"], time=tt, cost=cost, length=road["length_m"],
                   depth=depth, risk=st.get("risk_level", "LOW"))
    return g


def describe(city: str, g_full: nx.Graph, path: list[str], road_state: dict, mode: str) -> dict:
    w = get_world(city)
    cfg = MODES[mode]
    segs, coords = [], []
    dist = tt = exposure = 0.0
    max_depth = 0.0
    worst = "LOW"
    for a, b in zip(path, path[1:]):
        e = g_full.get_edge_data(a, b)
        road = w.road(e["id"])
        st = road_state.get(e["id"], {})
        d = max(st.get("depth_now_m", 0.0), st.get("depth_30_m", 0.0))
        pts = road["coords"] if road["from"] == a else list(reversed(road["coords"]))
        coords.extend(pts if not coords else pts[1:])
        speed = 5.0 if cfg["speed_factor"] is None else road["speed_kmh"] * cfg["speed_factor"]
        speed *= max(0.25, 1 - 0.8 * d / max(cfg["max_depth"], 0.05))
        t_ = road["length_m"] / 1000 / speed * 60
        dist += road["length_m"]
        tt += t_
        exposure += road["length_m"] * d
        max_depth = max(max_depth, d)
        r = st.get("risk_level", "LOW")
        if RISK_NUM.get(r, 0) > RISK_NUM.get(worst, 0):
            worst = r
        segs.append({"road_id": road["id"], "name": road["name"], "depth_m": round(d, 2), "risk_level": r,
                     "passable": d <= cfg["max_depth"], "length_m": road["length_m"]})
    flooded = [s for s in segs if s["depth_m"] >= 0.10]
    unsafe = [s for s in segs if not s["passable"]]
    return {"nodes": path, "coords": coords, "distance_km": round(dist / 1000, 2), "time_min": round(tt, 1),
            "max_depth_m": round(max_depth, 2), "flooded_segments": len(flooded), "unsafe_segments": len(unsafe),
            "exposure_m2": round(exposure, 1), "risk_level": worst, "segments": segs,
            "safe_for_mode": len(unsafe) == 0}


def route(city: str, road_state: dict, origin: tuple[float, float], dest: tuple[float, float], mode: str = "NORMAL",
          closures: set[str] | None = None, alternatives: int = 2) -> dict:
    mode = mode.upper()
    if mode not in MODES:
        raise ValueError(f"Unknown mode {mode}")
    o, d = nearest_node(city, *origin), nearest_node(city, *dest)
    g = weighted_graph(city, road_state, mode, closures)
    g_naive = weighted_graph(city, road_state, mode, closures, ignore_flood=True)
    out = {"mode": mode, "mode_label": MODES[mode]["label"], "max_safe_depth_m": MODES[mode]["max_depth"],
           "origin_node": o, "destination_node": d, "recommended": None, "alternatives": [], "shortest_ignoring_flood": None,
           "data_label": "MODEL_PREDICTION"}
    naive = nx.shortest_path(g_naive, o, d, weight="time") if nx.has_path(g_naive, o, d) else None
    if naive:
        out["shortest_ignoring_flood"] = describe(city, g_naive, naive, road_state, mode)
    if o not in g or d not in g or not nx.has_path(g, o, d):
        out["status"] = "NO_SAFE_ROUTE"
        out["message"] = (f"No flood-safe route for {MODES[mode]['label']} — all connections exceed "
                          f"{MODES[mode]['max_depth']} m safe depth. Consider {'EMERGENCY/FIRE' if mode not in ('FIRE','EMERGENCY') else 'aerial/boat'} resources.")
        return out
    paths = list(itertools.islice(nx.shortest_simple_paths(g, o, d, weight="cost"), 12))
    chosen = [paths[0]]
    for p in paths[1:]:
        if len(chosen) > alternatives:
            break
        overlap = len(set(zip(p, p[1:])) & set().union(*[set(zip(c, c[1:])) for c in chosen]))
        if overlap < 0.6 * (len(p) - 1):
            chosen.append(p)
    out["recommended"] = describe(city, g, chosen[0], road_state, mode)
    out["alternatives"] = [describe(city, g, p, road_state, mode) for p in chosen[1:]]
    out["status"] = "OK"
    nv = out["shortest_ignoring_flood"]
    if nv and nv["unsafe_segments"]:
        out["message"] = (f"Route diverted: the shortest path crosses {nv['unsafe_segments']} unsafe segment(s) "
                          f"(max {nv['max_depth_m']} m). Recommended route adds "
                          f"{round(out['recommended']['time_min'] - nv['time_min'], 1)} min but avoids flooded roads.")
    else:
        out["message"] = "Shortest route is currently flood-safe for this mode."
    return out


def reachable_fraction(city: str, road_state: dict, node: str, mode: str = "AMBULANCE") -> float:
    g = weighted_graph(city, road_state, mode)
    if node not in g:
        return 0.0
    comp = nx.node_connected_component(g, node)
    return len(comp) / max(len(get_world(city).road_nodes), 1)


def travel_times_from(city: str, road_state: dict, node: str, mode: str = "AMBULANCE") -> dict[str, float]:
    g = weighted_graph(city, road_state, mode)
    if node not in g:
        return {}
    return nx.single_source_dijkstra_path_length(g, node, weight="time")
