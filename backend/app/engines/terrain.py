"""DEM terrain analysis: slope, aspect, depression filling (priority-flood), D8 flow
direction, flow accumulation, catchments, low-lying areas and natural water paths."""
from __future__ import annotations

import heapq
from functools import lru_cache

import numpy as np

from app.engines.world import LANDCOVER, get_world

D8 = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
D8_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def priority_flood(dem: np.ndarray, eps: float = 1e-4) -> np.ndarray:
    """Barnes et al. (2014) priority-flood with epsilon so flats drain."""
    n, m = dem.shape
    filled = dem.copy()
    closed = np.zeros_like(dem, dtype=bool)
    heap: list = []
    for r in range(n):
        for c in (0, m - 1):
            heapq.heappush(heap, (filled[r, c], r, c)); closed[r, c] = True
    for c in range(1, m - 1):
        for r in (0, n - 1):
            heapq.heappush(heap, (filled[r, c], r, c)); closed[r, c] = True
    while heap:
        z, r, c = heapq.heappop(heap)
        for dr, dc in D8:
            rr, cc = r + dr, c + dc
            if 0 <= rr < n and 0 <= cc < m and not closed[rr, cc]:
                closed[rr, cc] = True
                filled[rr, cc] = max(filled[rr, cc], z + eps)
                heapq.heappush(heap, (filled[rr, cc], rr, cc))
    return filled


def d8_flow(filled: np.ndarray, cell_m: float) -> np.ndarray:
    n, m = filled.shape
    fd = np.full((n, m), -1, dtype=int)
    best = np.zeros((n, m))
    for k, (dr, dc) in enumerate(D8):
        dist = cell_m * (1.4142 if dr and dc else 1.0)
        shifted = np.full_like(filled, np.inf)
        rs = slice(max(dr, 0), n + min(dr, 0)); rd = slice(max(-dr, 0), n + min(-dr, 0))
        cs = slice(max(dc, 0), m + min(dc, 0)); cd = slice(max(-dc, 0), m + min(-dc, 0))
        shifted[rd, cd] = filled[rs, cs]
        drop = (filled - shifted) / dist
        upd = drop > best
        best[upd] = drop[upd]
        fd[upd] = k
    return fd


def flow_accumulation(filled: np.ndarray, fd: np.ndarray) -> np.ndarray:
    n, m = filled.shape
    acc = np.ones((n, m))
    order = np.argsort(-filled, axis=None)
    for idx in order:
        r, c = divmod(int(idx), m)
        k = fd[r, c]
        if k < 0:
            continue
        rr, cc = r + D8[k][0], c + D8[k][1]
        if 0 <= rr < n and 0 <= cc < m:
            acc[rr, cc] += acc[r, c]
    return acc


def catchments(filled: np.ndarray, fd: np.ndarray, acc: np.ndarray, top: int = 8) -> np.ndarray:
    n, m = filled.shape
    outlet = -np.ones((n, m), dtype=int)
    order = np.argsort(filled, axis=None)  # low -> high so downstream labelled first
    ids = {}
    for idx in order:
        r, c = divmod(int(idx), m)
        k = fd[r, c]
        rr, cc = (r + D8[k][0], c + D8[k][1]) if k >= 0 else (-1, -1)
        if k < 0 or not (0 <= rr < n and 0 <= cc < m):
            outlet[r, c] = ids.setdefault((r, c), len(ids))
        else:
            outlet[r, c] = outlet[rr, cc] if outlet[rr, cc] >= 0 else ids.setdefault((r, c), len(ids))
    labels, counts = np.unique(outlet, return_counts=True)
    keep = labels[np.argsort(-counts)[:top]]
    remap = {int(l): i + 1 for i, l in enumerate(keep)}
    return np.vectorize(lambda v: remap.get(int(v), 0))(outlet)


@lru_cache(maxsize=8)
def analyse(city: str) -> dict:
    w = get_world(city)
    dem = w.dem
    gy, gx = np.gradient(dem, w.cell_m)
    slope_pct = np.hypot(gx, gy) * 100
    slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))
    aspect = (np.degrees(np.arctan2(-gx, gy)) + 360) % 360
    filled = priority_flood(dem)
    depression = filled - dem
    fd = d8_flow(filled, w.cell_m)
    acc = flow_accumulation(filled, fd)
    cat = catchments(filled, fd, acc)
    p15 = np.percentile(dem, 15)
    low = (dem <= p15) | (depression > 0.25)
    paths = acc >= max(40, np.percentile(acc, 93))
    return {"slope_pct": slope_pct, "slope_deg": slope_deg, "aspect": aspect, "filled": filled,
            "depression": depression, "flow_dir": fd, "flow_acc": acc, "catchment": cat,
            "low_lying": low, "water_paths": paths}


def summary(city: str) -> dict:
    w = get_world(city)
    t = analyse(city)
    n = w.n
    elev_pct = (np.argsort(np.argsort(w.dem.ravel())) / (n * n)).reshape(n, n)
    cells = []
    for r in range(n):
        for c in range(n):
            cells.append({
                "r": r, "c": c, "bounds": w.cell_bounds(r, c),
                "elevation_m": round(float(w.dem[r, c]), 2),
                "slope_pct": round(float(t["slope_pct"][r, c]), 2),
                "aspect_deg": round(float(t["aspect"][r, c]), 0),
                "flow_dir": D8_NAMES[t["flow_dir"][r, c]] if t["flow_dir"][r, c] >= 0 else "OUTLET",
                "flow_acc": int(t["flow_acc"][r, c]),
                "catchment": int(t["catchment"][r, c]),
                "depression_m": round(float(t["depression"][r, c]), 2),
                "low_lying": bool(t["low_lying"][r, c]),
                "water_path": bool(t["water_paths"][r, c]),
                "landcover": LANDCOVER[int(w.landcover[r, c])]["name"],
                "impervious": round(float(w.impervious[r, c]), 2),
                "elevation_pct": round(float(elev_pct[r, c]), 3),
            })
    lc_counts = {LANDCOVER[k]["name"]: int((w.landcover == k).sum()) for k in LANDCOVER}
    ward_stats = []
    for i, wd in enumerate(w.wards):
        m = w.ward == i
        ward_stats.append({"ward": wd["name"], "mean_elevation_m": round(float(w.dem[m].mean()), 2),
                           "min_elevation_m": round(float(w.dem[m].min()), 2),
                           "mean_slope_pct": round(float(t["slope_pct"][m].mean()), 2),
                           "low_lying_pct": round(float(t["low_lying"][m].mean() * 100), 1),
                           "imperviousness_pct": round(float(w.impervious[m].mean() * 100), 1)})
    return {
        "city": city, "grid": {"rows": n, "cols": n, "cell_m": round(w.cell_m, 1), "bbox": w.bbox},
        "data_label": "DEMO_DATA", "source": "Deterministic synthetic DEM (replaceable by SRTM 30m / Cartosat-1 DEM GeoTIFF)",
        "stats": {"min_elevation_m": round(float(w.dem.min()), 2), "max_elevation_m": round(float(w.dem.max()), 2),
                  "mean_slope_pct": round(float(t["slope_pct"].mean()), 2),
                  "low_lying_cells": int(t["low_lying"].sum()), "depression_cells": int((t["depression"] > 0.05).sum()),
                  "catchments": int(t["catchment"].max()), "water_path_cells": int(t["water_paths"].sum()),
                  "mean_imperviousness_pct": round(float(w.impervious.mean() * 100), 1)},
        "landcover_counts": lc_counts, "landcover_classes": LANDCOVER, "wards": ward_stats, "cells": cells,
        "method": ["Priority-flood depression filling (Barnes 2014)", "D8 steepest-descent flow direction",
                   "Topologically sorted flow accumulation", "Outlet-labelled catchment delineation",
                   "Low-lying = 15th elevation percentile or depression > 0.25 m"],
    }
