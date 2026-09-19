"""Deterministic city 'world' generator: DEM, land cover, wards, road network,
drainage-network digital twin and critical infrastructure.

Everything here is DEMO DATA derived from a seeded generator so that every run of the
platform produces identical geography. Real datasets (SRTM/Cartosat DEM, OSM roads,
municipal drainage GIS) can replace any layer through `app.engines.loaders`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

import heapq
import networkx as nx
import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

from app.core.config import get_settings
from app.data.cities import INFRA_KINDS, get_city

LANDCOVER = {
    1: {"name": "Dense urban", "impervious": 0.90, "C": 0.88, "CN": 94, "roughness": 0.015},
    2: {"name": "Residential", "impervious": 0.65, "C": 0.70, "CN": 86, "roughness": 0.030},
    3: {"name": "Commercial", "impervious": 0.85, "C": 0.85, "CN": 92, "roughness": 0.015},
    4: {"name": "Parks / green", "impervious": 0.12, "C": 0.20, "CN": 61, "roughness": 0.060},
    5: {"name": "Water body", "impervious": 1.00, "C": 1.00, "CN": 98, "roughness": 0.035},
    6: {"name": "Bare / open soil", "impervious": 0.30, "C": 0.40, "CN": 77, "roughness": 0.040},
}


@dataclass
class World:
    key: str
    meta: dict
    n: int
    bbox: tuple[float, float, float, float]  # south, west, north, east
    cell_m: float
    dem: np.ndarray
    landcover: np.ndarray
    impervious: np.ndarray
    river_mask: np.ndarray
    ward: np.ndarray
    wards: list[dict]
    road_nodes: list[dict]
    roads: list[dict]
    road_graph: nx.Graph
    drain_nodes: list[dict]
    drain_edges: list[dict]
    drain_order: list[str]            # upstream -> downstream topological order
    node_cells: dict[str, np.ndarray]  # flat cell indices draining to each inlet node
    cell_node: np.ndarray              # (n*n,) index of drainage node for each cell
    infrastructure: list[dict]
    cctv: list[dict]
    design_intensity: float
    extras: dict = field(default_factory=dict)

    # ---- coordinate helpers -------------------------------------------------------
    def rc_to_latlon(self, r: float, c: float) -> tuple[float, float]:
        s, w, nlat, e = self.bbox
        lat = nlat - (r + 0.5) * (nlat - s) / self.n
        lon = w + (c + 0.5) * (e - w) / self.n
        return round(lat, 6), round(lon, 6)

    def latlon_to_rc(self, lat: float, lon: float) -> tuple[int, int]:
        s, w, nlat, e = self.bbox
        r = int((nlat - lat) / (nlat - s) * self.n)
        c = int((lon - w) / (e - w) * self.n)
        return min(max(r, 0), self.n - 1), min(max(c, 0), self.n - 1)

    def cell_bounds(self, r: int, c: int) -> list[list[float]]:
        s, w, nlat, e = self.bbox
        dlat, dlon = (nlat - s) / self.n, (e - w) / self.n
        top, left = nlat - r * dlat, w + c * dlon
        return [[top - dlat, left], [top, left + dlon]]

    @property
    def cell_area(self) -> float:
        return self.cell_m * self.cell_m

    def node(self, nid: str) -> dict | None:
        return self.extras["drain_index"].get(nid)

    def road(self, rid: str) -> dict | None:
        return self.extras["road_index"].get(rid)


# ---------------------------------------------------------------------------------
def _dem(n: int, meta: dict, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    # regional tilt towards the river valley
    river_row = 0.62 * n + 3.5 * np.sin(xx / 6.5 + meta["seed"] % 7)
    dist_river = np.abs(yy - river_row)
    z = 0.55 * (dist_river / n)
    z += 0.10 * (xx / n)
    # hills
    for _ in range(4):
        cy, cx = rng.uniform(0.05, 0.95, 2) * n
        s = rng.uniform(4, 9)
        z += rng.uniform(0.15, 0.35) * np.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * s * s))
    # low-lying pockets (underpasses, old tank beds) — flood hotspots
    pockets = []
    for i in range(6):
        cy, cx = rng.uniform(0.15, 0.85, 2) * n
        if abs(cy - (0.62 * n)) < 4:
            cy -= 7
        s = rng.uniform(1.8, 3.2)
        d = rng.uniform(0.9, 1.8) / meta["relief"] * 1.4   # ~0.9–1.8 m deep pockets
        z -= d * np.exp(-((yy - cy) ** 2 + (xx - cx) ** 2) / (2 * s * s))
        pockets.append((cy, cx))
    noise = gaussian_filter(rng.normal(0, 1, (n, n)), 2.2)
    z += 0.035 * noise / (np.abs(noise).max() + 1e-9)
    # river channel carved in
    channel = np.exp(-(dist_river ** 2) / (2 * 0.9 ** 2))
    z -= 0.12 * channel
    z = (z - z.min()) / (z.max() - z.min())
    dem = meta["base_elev"] + meta["relief"] * z
    river_mask = dist_river < 1.0
    return dem.astype(float), river_mask


def _landcover(n: int, dem: np.ndarray, river: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    cen = np.hypot(yy - n / 2, xx - n / 2) / (n / 2)
    lc = np.full((n, n), 2, dtype=int)
    lc[cen < 0.45] = 1
    lc[(cen < 0.25)] = 3
    field_ = gaussian_filter(rng.normal(0, 1, (n, n)), 3)
    lc[field_ > 0.35] = 4           # parks
    lc[(field_ < -0.45) & (cen > 0.6)] = 6
    lc[river] = 5
    return lc


def _wards(n: int, names: list[str]) -> tuple[np.ndarray, list[dict]]:
    k = int(math.sqrt(len(names)))
    centers = []
    for i in range(k):
        for j in range(k):
            centers.append(((i + 0.5) * n / k, (j + 0.5) * n / k))
    tree = cKDTree(centers)
    yy, xx = np.mgrid[0:n, 0:n]
    _, idx = tree.query(np.c_[yy.ravel(), xx.ravel()])
    ward = idx.reshape(n, n)
    wards = [{"id": f"W{i+1:02d}", "name": names[i], "center_rc": centers[i]} for i in range(len(centers))]
    return ward, wards


def _manning_capacity(d: float, slope: float, n_: float = 0.013) -> float:
    a = math.pi * d * d / 4
    r = d / 4
    return (1 / n_) * a * r ** (2 / 3) * math.sqrt(max(slope, 0.0005))


def _diameter_for(q: float, slope: float) -> float:
    lo, hi = 0.3, 6.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if _manning_capacity(mid, slope) < q:
            lo = mid
        else:
            hi = mid
    return hi


def build_world(key: str) -> World:
    meta = get_city(key)
    settings = get_settings()
    n = settings.grid_size
    rng = np.random.default_rng(meta["seed"])
    lat0, lon0 = meta["center"]
    half = meta["span_deg"] / 2
    bbox = (lat0 - half, lon0 - half, lat0 + half, lon0 + half)
    cell_m = meta["span_deg"] * 111_320 * math.cos(math.radians(lat0)) / n

    dem, river = _dem(n, meta, rng)
    lc = _landcover(n, dem, river, rng)
    imperv = np.vectorize(lambda v: LANDCOVER[int(v)]["impervious"])(lc).astype(float)
    ward, wards = _wards(n, meta["areas"])

    w = World(key=key, meta=meta, n=n, bbox=bbox, cell_m=cell_m, dem=dem, landcover=lc, impervious=imperv,
              river_mask=river, ward=ward, wards=wards, road_nodes=[], roads=[], road_graph=nx.Graph(),
              drain_nodes=[], drain_edges=[], drain_order=[], node_cells={}, cell_node=np.zeros(n * n, int),
              infrastructure=[], cctv=[], design_intensity=55.0 if key != "mumbai" else 60.0)
    for wd in w.wards:
        wd["center"] = w.rc_to_latlon(*wd["center_rc"])

    _build_roads(w, rng)
    _build_drainage(w, rng)
    _build_infrastructure(w, rng)
    w.extras["drain_index"] = {d["id"]: d for d in w.drain_nodes}
    w.extras["road_index"] = {r["id"]: r for r in w.roads}
    w.extras["edge_index"] = {e["id"]: e for e in w.drain_edges}
    return w


def _build_roads(w: World, rng: np.random.Generator) -> None:
    n, K = w.n, 10
    spacing = (n - 4) / (K - 1)
    streets = w.meta["streets"]
    names_h = [streets[i % len(streets)] for i in range(K)]
    names_v = [streets[(i + K) % len(streets)] if i + K < len(streets) else f"{w.meta['areas'][i]} Cross Rd" for i in range(K)]
    grid = {}
    for i in range(K):
        for j in range(K):
            r = 2 + i * spacing + rng.uniform(-0.9, 0.9)
            c = 2 + j * spacing + rng.uniform(-0.9, 0.9)
            r, c = float(np.clip(r, 0.5, n - 1.5)), float(np.clip(c, 0.5, n - 1.5))
            nid = f"J{i:02d}{j:02d}"
            lat, lon = w.rc_to_latlon(r, c)
            ri, ci = int(round(r)), int(round(c))
            node = {"id": nid, "i": i, "j": j, "r": r, "c": c, "lat": lat, "lon": lon,
                    "elevation_m": round(float(w.dem[ri, ci]), 2),
                    "ward": w.wards[int(w.ward[ri, ci])]["name"]}
            grid[(i, j)] = node
            w.road_nodes.append(node)
            w.road_graph.add_node(nid, **node)

    def add_edge(a, b, name, cls):
        rid = f"R{len(w.roads) + 1:03d}"
        pts_rc = [(a["r"] + (b["r"] - a["r"]) * t, a["c"] + (b["c"] - a["c"]) * t) for t in np.linspace(0, 1, 7)]
        cells = sorted({(int(round(p[0])), int(round(p[1]))) for p in pts_rc})
        length = math.hypot(a["r"] - b["r"], a["c"] - b["c"]) * w.cell_m
        elev = float(np.mean([w.dem[r, c] for r, c in cells]))
        mid = pts_rc[len(pts_rc) // 2]
        ward_name = w.wards[int(w.ward[int(round(mid[0])), int(round(mid[1]))])]["name"]
        underpass = bool(rng.random() < 0.06)
        road = {
            "id": rid, "name": f"{name} ({ward_name})", "street": name, "ward": ward_name, "road_class": cls,
            "from": a["id"], "to": b["id"], "length_m": round(length, 1), "elevation_m": round(elev, 2),
            "lanes": 6 if cls == "arterial" else 4 if cls == "collector" else 2,
            "speed_kmh": 50 if cls == "arterial" else 35 if cls == "collector" else 25,
            "underpass": underpass, "cells": cells,
            "coords": [list(w.rc_to_latlon(p[0], p[1])) for p in pts_rc],
        }
        w.roads.append(road)
        w.road_graph.add_edge(a["id"], b["id"], id=rid, length=length)

    for i in range(K):
        for j in range(K):
            a = grid[(i, j)]
            if j + 1 < K:
                cls = "arterial" if i in (2, 6) else "collector" if i % 2 == 0 else "local"
                if cls != "local" or rng.random() > 0.08:
                    add_edge(a, grid[(i, j + 1)], names_h[i], cls)
            if i + 1 < K:
                cls = "arterial" if j in (3, 7) else "collector" if j % 2 == 1 else "local"
                if cls != "local" or rng.random() > 0.08:
                    add_edge(a, grid[(i + 1, j)], names_v[j], cls)
    # keep only largest connected component
    comp = max(nx.connected_components(w.road_graph), key=len)
    drop = set(w.road_graph.nodes) - comp
    w.road_graph.remove_nodes_from(drop)
    w.road_nodes = [x for x in w.road_nodes if x["id"] in comp]
    w.roads = [r for r in w.roads if r["from"] in comp and r["to"] in comp]


def _build_drainage(w: World, rng: np.random.Generator) -> None:
    n = w.n
    nodes: dict[str, dict] = {}
    for rn in w.road_nodes:
        deg = w.road_graph.degree(rn["id"])
        nid = "MH" + rn["id"][1:]
        ri, ci = int(round(rn["r"])), int(round(rn["c"]))
        nodes[nid] = {"id": nid, "kind": "junction" if deg >= 4 else "manhole", "r": rn["r"], "c": rn["c"],
                      "lat": rn["lat"], "lon": rn["lon"], "elevation_m": round(float(w.dem[ri, ci]), 2),
                      "road_node": rn["id"], "ward": rn["ward"], "connected_roads": []}
    for road in w.roads:
        nodes["MH" + road["from"][1:]]["connected_roads"].append(road["id"])
        nodes["MH" + road["to"][1:]]["connected_roads"].append(road["id"])
    # outfalls along the river channel
    river_cells = np.argwhere(w.river_mask)
    outfalls = []
    for k, col in enumerate(np.linspace(3, n - 4, 6)):
        cand = river_cells[np.abs(river_cells[:, 1] - col) < 0.6]
        if len(cand) == 0:
            continue
        r, c = cand[len(cand) // 2]
        oid = f"OF{k+1:02d}"
        lat, lon = w.rc_to_latlon(r, c)
        nodes[oid] = {"id": oid, "kind": "outfall", "r": float(r), "c": float(c), "lat": lat, "lon": lon,
                      "elevation_m": round(float(w.dem[r, c]), 2), "road_node": None,
                      "ward": w.wards[int(w.ward[r, c])]["name"], "connected_roads": []}
        outfalls.append(oid)

    # adjacency: drains follow road corridors; outfalls connect to nearby junctions
    adj: dict[str, set] = {k: set() for k in nodes}
    for a, b in w.road_graph.edges:
        na, nb = "MH" + a[1:], "MH" + b[1:]
        adj[na].add(nb)
        adj[nb].add(na)
    jn = [k for k in nodes if not k.startswith("OF")]
    tree = cKDTree([(nodes[k]["r"], nodes[k]["c"]) for k in jn])
    for oid in outfalls:
        o = nodes[oid]
        for d, idx in zip(*tree.query((o["r"], o["c"]), k=3)):
            adj[oid].add(jn[idx])
            adj[jn[idx]].add(oid)

    # priority-flood from outfalls builds a drainage forest (mostly downhill, some adverse grades)
    downstream: dict[str, str] = {}
    seen = set(outfalls)
    heap = [(nodes[o]["elevation_m"], o) for o in outfalls]
    heapq.heapify(heap)
    order_from_outlet = []
    while heap:
        _, cur = heapq.heappop(heap)
        order_from_outlet.append(cur)
        for nb in sorted(adj[cur]):
            if nb not in seen:
                seen.add(nb)
                downstream[nb] = cur
                heapq.heappush(heap, (nodes[nb]["elevation_m"], nb))

    # street inlets at segment midpoints (lateral into nearest segment end with lower elevation)
    inlets = []
    for road in w.roads:
        if rng.random() < 0.45:
            continue
        mid = road["coords"][len(road["coords"]) // 2]
        r, c = w.latlon_to_rc(*mid)
        a, b = "MH" + road["from"][1:], "MH" + road["to"][1:]
        tgt = a if nodes[a]["elevation_m"] <= nodes[b]["elevation_m"] else b
        iid = f"IN{len(inlets)+1:03d}"
        nodes[iid] = {"id": iid, "kind": "inlet", "r": float(r), "c": float(c), "lat": mid[0], "lon": mid[1],
                      "elevation_m": round(float(w.dem[r, c]), 2), "road_node": None, "ward": road["ward"],
                      "connected_roads": [road["id"]]}
        downstream[iid] = tgt
        inlets.append(iid)

    # topological order upstream -> downstream
    children: dict[str, list] = {k: [] for k in nodes}
    for u, d in downstream.items():
        children[d].append(u)
    depth_cache = {}

    def depth(nid):
        if nid in depth_cache:
            return depth_cache[nid]
        d = 0 if nid not in downstream else 1 + depth(downstream[nid])
        depth_cache[nid] = d
        return d
    order = sorted(nodes, key=lambda k: -depth(k))

    # catchment assignment: every land cell drains to the nearest non-outfall node
    catch_ids = [k for k in nodes if nodes[k]["kind"] != "outfall"]
    ctree = cKDTree([(nodes[k]["r"], nodes[k]["c"]) for k in catch_ids])
    yy, xx = np.mgrid[0:n, 0:n]
    _, idx = ctree.query(np.c_[yy.ravel(), xx.ravel()])
    cell_node = idx
    node_cells = {k: np.where(idx == i)[0] for i, k in enumerate(catch_ids)}
    C = np.vectorize(lambda v: LANDCOVER[int(v)]["C"])(w.landcover).ravel()

    # upstream contributing area x C for pipe sizing (rational method)
    contrib = {k: 0.0 for k in nodes}
    for k in catch_ids:
        cells = node_cells[k]
        contrib[k] = float(C[cells].sum() * w.cell_area)
    acc = dict(contrib)
    for k in order:
        if k in downstream:
            acc[downstream[k]] += acc[k]

    edges = []
    for u in order:
        if u not in downstream:
            continue
        d = downstream[u]
        nu, nd = nodes[u], nodes[d]
        length = max(math.hypot(nu["r"] - nd["r"], nu["c"] - nd["c"]) * w.cell_m, 25.0)
        inv_u = nu["elevation_m"] - (1.2 if nu["kind"] == "inlet" else 2.0)
        inv_d = nd["elevation_m"] - (0.5 if nd["kind"] == "outfall" else 2.0)
        slope = (inv_u - inv_d) / length
        adverse = slope <= 0.0005
        design_q = w.design_intensity * acc[u] / 3.6e6
        factor = rng.uniform(0.9, 1.3)
        legacy = rng.random() < 0.13
        if legacy:
            factor = rng.uniform(0.45, 0.65)
        cap = max(design_q * factor, 0.08)
        s_eff = max(slope, 0.001)
        dia = _diameter_for(cap, s_eff)
        cap = _manning_capacity(dia, s_eff)
        kind = "box_drain" if dia > 2.2 else "pipe"
        edges.append({
            "id": f"P{len(edges)+1:03d}", "from": u, "to": d, "length_m": round(length, 1),
            "diameter_m": round(dia, 2), "slope": round(slope, 5), "roughness": 0.013,
            "capacity_m3s": round(cap, 3), "adverse_grade": adverse, "legacy_undersized": legacy,
            "conduit": kind, "coords": [[nu["lat"], nu["lon"]], [nd["lat"], nd["lon"]]],
            "full_velocity_ms": round(cap / (math.pi * dia * dia / 4), 2),
        })
        nu["invert_m"] = round(inv_u, 2)
    edge_by_from = {e["from"]: e for e in edges}
    for k, nd in nodes.items():
        nd.setdefault("invert_m", round(nd["elevation_m"] - 2.0, 2))
        nd["downstream"] = downstream.get(k)
        nd["upstream"] = children[k]
        e = edge_by_from.get(k)
        nd["capacity_m3s"] = e["capacity_m3s"] if e else round(max(acc[k] * 80 / 3.6e6, 5.0), 2)
        # ASSUMED blockage: no sensors — derived from a maintenance-age model (SIMULATED)
        days = int(rng.integers(5, 240))
        nd["days_since_cleaning"] = days
        nd["baseline_blockage"] = round(float(np.clip(days / 240 * 0.22 + rng.normal(0, 0.03), 0.0, 0.35)), 3)
        nd["storage_m3"] = round(8.0 if nd["kind"] == "inlet" else 25.0 if nd["kind"] != "outfall" else 1e9, 1)
        nd["historical_failures"] = int(rng.poisson(1.5 if e and e["legacy_undersized"] else 0.4))
        nd["catchment_m2"] = round(float(len(node_cells.get(k, [])) * w.cell_area), 1)
    w.drain_nodes = list(nodes.values())
    w.drain_edges = edges
    w.drain_order = order
    w.node_cells = node_cells
    w.cell_node = cell_node
    w.extras["catch_ids"] = catch_ids


def _build_infrastructure(w: World, rng: np.random.Generator) -> None:
    labels = {"hospital": ["General Hospital", "Area Hospital", "Community Health Centre", "Maternity Hospital",
                           "Multi-speciality Hospital", "Urban Health Centre"],
              "police": ["Police Station", "Traffic Police Post", "Police Outpost", "Police Control Room", "Women Police Station"],
              "fire_station": ["Fire Station", "Fire & Rescue Post", "Fire Sub-station", "Emergency Fire Unit"],
              "school": ["Govt High School", "Public School", "Primary School", "Junior College", "Model School", "Girls High School"],
              "railway_station": ["Railway Station", "Metro Station", "MMTS/Suburban Station"],
              "bus_terminal": ["Bus Terminal", "Bus Depot"],
              "shelter": ["Relief Shelter", "Community Hall Shelter", "Cyclone/Flood Shelter", "School Relief Camp"],
              "substation": ["33kV Substation", "11kV Substation", "132kV Substation", "Distribution Substation"],
              "government": ["Ward Office", "Zonal Municipal Office", "Collectorate Annex"]}
    rnodes = w.road_nodes
    # hotspot-adjacent intersections (lowest) so the demo shows exposed facilities
    by_elev = sorted(rnodes, key=lambda x: x["elevation_m"])
    used = set()
    items = []
    for kind, cfg in INFRA_KINDS.items():
        for k in range(cfg["count"]):
            if kind in ("hospital", "school", "substation") and k == 0:
                pool = by_elev[:12]
            elif kind == "shelter":
                pool = by_elev[-30:]  # shelters on high ground
            else:
                pool = rnodes
            choices = [p for p in pool if p["id"] not in used] or rnodes
            p = choices[int(rng.integers(0, len(choices)))]
            used.add(p["id"])
            lat = p["lat"] + float(rng.uniform(-0.0015, 0.0015))
            lon = p["lon"] + float(rng.uniform(-0.0015, 0.0015))
            iid = f"{kind[:3].upper()}{k+1:02d}"
            items.append({"id": iid, "kind": kind, "name": f"{p['ward']} {labels[kind][k % len(labels[kind])]}", "lat": round(lat, 6),
                          "lon": round(lon, 6), "road_node": p["id"], "ward": p["ward"],
                          "capacity": int(rng.integers(50, 600)) if kind in ("hospital", "shelter", "school") else 0,
                          "critical": kind in ("hospital", "fire_station", "police", "substation"),
                          "data_label": "DEMO_DATA"})
    w.infrastructure = items
    for k, p in enumerate(sorted(rnodes, key=lambda x: -w.road_graph.degree(x["id"]))[:8]):
        w.cctv.append({"id": f"CAM{k+1:02d}", "name": f"{p['ward']} Junction Camera", "lat": p["lat"], "lon": p["lon"],
                       "road_node": p["id"], "ward": p["ward"],
                       "note": "Analysis location for uploaded/recorded footage (no live hardware feed)"})


@lru_cache(maxsize=8)
def get_world(key: str) -> World:
    return build_world(key.lower())
