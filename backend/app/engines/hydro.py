"""Coupled 1D-2D urban flood model (transparent baseline, SWMM-compatible concepts).

Per 5-minute step:
  1. Rainfall -> excess runoff by SCS Curve Number on cumulative depth (per grid cell).
  2. Runoff joins the surface layer h (m).
  3. Inlet capture: each drainage node captures surface water from its catchment,
     limited by inlet capacity (pipe capacity x (1 - blockage) x 1.3) and by free room.
  4. Drainage hydraulics (1D): topological routing through the directed pipe graph.
     Pipe capacity = Manning full-flow capacity x capacity factor x (1 - blockage),
     reduced by backwater when the downstream node is surcharged / outfall tailwater high.
     Excess volume fills manhole storage; beyond that -> OVERFLOW back to the surface.
  5. Surface flow (2D): water-surface-elevation cellular automaton (diffusive routing)
     moves water to low-lying cells; river cells act as fixed-head boundary.
  6. Infiltration of ponded water on pervious cells.

Node states: NORMAL (<60%) · HIGH_LOAD (<80%) · NEAR_CAPACITY (<100%) ·
OVERLOADED (demand ≥ capacity, surcharged) · OVERFLOW (water leaving manhole to street).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict

import numpy as np

from app.engines.world import LANDCOVER, World, get_world

DT_MIN = 5
FLOOD_DEPTH = 0.10    # m — a cell/road counts as flooded
STATES = ["NORMAL", "HIGH_LOAD", "NEAR_CAPACITY", "OVERLOADED", "OVERFLOW"]


@dataclass
class HydroParams:
    capacity_factor: float = 1.0      # drainage capacity multiplier (0.2–1.5)
    blockage_pct: float | None = None  # override blockage everywhere (0–90); None = assumed per-node blockage
    extra_blockage_pct: float = 0.0   # added on top of assumed blockage
    imperviousness_delta: float = 0.0  # fraction added to imperviousness (−0.3..+0.3)
    tailwater_m: float = 0.5          # initial water level in river/outfalls (m)
    initial_depth_m: float = 0.0      # initial ponded water on the surface (m)

    def key(self) -> tuple:
        return tuple(sorted(asdict(self).items()))


def node_state(util: float, overflow: float) -> str:
    if overflow > 0.5:  # m3 in step
        return "OVERFLOW"
    if util >= 1.0:
        return "OVERLOADED"
    if util >= 0.8:
        return "NEAR_CAPACITY"
    if util >= 0.6:
        return "HIGH_LOAD"
    return "NORMAL"


class CoupledModel:
    def __init__(self, city: str, params: HydroParams | None = None):
        self.w: World = get_world(city)
        self.p = params or HydroParams()
        w, p = self.w, self.p
        n = w.n
        cn = np.vectorize(lambda v: LANDCOVER[int(v)]["CN"])(w.landcover).astype(float)
        d = float(np.clip(p.imperviousness_delta, -0.5, 0.5))
        self.cn = np.clip(cn + d * ((98 - cn) if d > 0 else cn - 40), 30, 98)
        self.S = 25400.0 / self.cn - 254.0  # mm
        self.imperv = np.clip(w.impervious + d, 0, 1)
        self.A = w.cell_area
        self.catch_ids: list[str] = w.extras["catch_ids"]
        self.cell_node = w.cell_node
        self.nodes = w.extras["drain_index"]
        self.edge_from = {e["from"]: e for e in w.drain_edges}
        self.order = w.drain_order
        self.node_rc = {k: (int(round(v["r"])), int(round(v["c"]))) for k, v in self.nodes.items()}
        self.tw_factor = float(np.clip(1 - max(0.0, p.tailwater_m - 0.5) / 2.5, 0.1, 1.0))
        self.river = w.river_mask
        self.river_h = max(0.0, p.tailwater_m - 0.5) * 1.5
        self.blockage = {}
        for k, nd in self.nodes.items():
            b = nd["baseline_blockage"] if p.blockage_pct is None else p.blockage_pct / 100
            b = b + p.extra_blockage_pct / 100
            self.blockage[k] = float(np.clip(b, 0, 0.95)) if nd["kind"] != "outfall" else 0.0
        self.pipe_cap = {}
        for k, nd in self.nodes.items():
            e = self.edge_from.get(k)
            base = e["capacity_m3s"] if e else nd["capacity_m3s"]
            self.pipe_cap[k] = base * p.capacity_factor * (1 - self.blockage[k]) * (self.tw_factor if nd["kind"] == "outfall" else 1)

    # ------------------------------------------------------------------------------
    def initial_state(self) -> dict:
        n = self.w.n
        h = np.full((n, n), max(self.p.initial_depth_m, 0.0))
        h[self.river] = self.river_h
        prefill = min(1.0, max(0.0, self.p.tailwater_m - 0.5) / 3.0)
        return {"t": 0.0, "h": h, "cumP": np.zeros((n, n)), "cumQ": np.zeros((n, n)),
                "store": {k: prefill * v["storage_m3"] if v["kind"] != "outfall" else 0.0 for k, v in self.nodes.items()},
                "surcharge": {k: 0.0 for k in self.nodes}, "outfall_ratio": {k: 0.0 for k in self.nodes}}

    @staticmethod
    def copy_state(s: dict) -> dict:
        return {"t": s["t"], "h": s["h"].copy(), "cumP": s["cumP"].copy(), "cumQ": s["cumQ"].copy(),
                "store": dict(s["store"]), "surcharge": dict(s["surcharge"]), "outfall_ratio": dict(s["outfall_ratio"])}

    def step(self, s: dict, rain: np.ndarray, dt_min: float = DT_MIN) -> dict:
        """Advance state `s` in place by dt with rainfall grid `rain` (mm/hr). Returns diagnostics."""
        dt = dt_min * 60.0
        A = self.A
        # 1-2 runoff (SCS-CN on cumulative rainfall)
        P_new = s["cumP"] + rain * dt_min / 60.0
        Ia = 0.2 * self.S
        Q_new = np.where(P_new > Ia, (P_new - Ia) ** 2 / (P_new + 0.8 * self.S), 0.0)
        runoff_mm = np.maximum(Q_new - s["cumQ"], 0)
        s["cumP"], s["cumQ"] = P_new, Q_new
        h = s["h"]
        h += runoff_mm / 1000.0
        runoff_rate = runoff_mm / 1000.0 * A / dt  # m3/s per cell

        # 3-4 inlet capture + drainage routing
        vol_surface = np.bincount(self.cell_node, weights=(h.ravel() * A) * (~self.river).ravel(),
                                  minlength=len(self.catch_ids))
        vs = {k: float(vol_surface[i]) for i, k in enumerate(self.catch_ids)}
        inflow_up = {k: 0.0 for k in self.nodes}
        res = {}
        capture_frac = np.zeros(len(self.catch_ids))
        overflow_grid = np.zeros_like(h)
        for k in self.order:
            nd = self.nodes[k]
            kind = nd["kind"]
            cap = self.pipe_cap[k]
            if kind == "outfall":
                q_in = inflow_up[k] / dt
                ratio = q_in / max(cap, 1e-6)
                s["outfall_ratio"][k] = ratio
                res[k] = {"inflow": q_in, "outflow": min(q_in, cap), "util": ratio, "overflow": 0.0,
                          "backflow": ratio > 1.0, "storage": 0.0, "captured": 0.0, "surface": 0.0}
                continue
            down = nd["downstream"]
            bw = 1.0
            if down:
                dn = self.nodes[down]
                if dn["kind"] == "outfall":
                    r_ = s["outfall_ratio"].get(down, 0.0)
                    bw = 1.0 if r_ <= 1 else max(0.35, 1 / r_)
                else:
                    sr = s["surcharge"].get(down, 0.0)
                    bw = 1.0 - 0.45 * sr
            cap_vol = cap * bw * dt
            smax = nd["storage_m3"]
            up = inflow_up[k]
            stored = s["store"][k]
            # clogged grates reduce capture faster than pipe conveyance: inlet efficiency ~ (1 - blockage)^2
            inlet_vol = cap / max(self.p.capacity_factor, 0.05) * 1.3 * (1 - self.blockage[k]) * dt
            surface = vs.get(k, 0.0)
            room = max(0.0, cap_vol + (smax - stored) - up)
            capture = min(surface, inlet_vol, room)
            total = up + stored + capture
            out = min(total, cap_vol)
            left = total - out
            overflow = max(0.0, left - smax)
            new_store = left - overflow
            s["store"][k] = new_store
            s["surcharge"][k] = new_store / smax if smax > 0 else 0.0
            # utilisation = what the catchment asks the drain to carry (through clean inlets) vs what the
            # blocked/derated pipe can carry — so blockage raises utilisation even though less water enters.
            clean_inlet = cap / max(1 - self.blockage[k], 0.05) / max(self.p.capacity_factor, 0.05) * 1.3 * dt
            demand_rate = (up + min(surface, clean_inlet)) / dt
            util = demand_rate / max(cap, 1e-6)
            if k in vs:
                capture_frac[self.catch_ids.index(k)] = capture / surface if surface > 0 else 0.0
            if overflow > 0:
                r, c = self.node_rc[k]
                overflow_grid[r, c] += overflow / A
            if down:
                inflow_up[down] += out
            res[k] = {"inflow": demand_rate, "outflow": out / dt, "util": util, "overflow": overflow,
                      "backflow": bw < 0.98, "storage": s["surcharge"][k], "captured": capture / dt, "surface": surface}
        h *= (1 - capture_frac[self.cell_node]).reshape(h.shape)
        h += overflow_grid

        # 5 surface routing
        self._route_surface(h, iters=3)
        # 6 infiltration of ponded water on pervious cells (15 mm/hr x perviousness)
        f = 15.0 * (1 - self.imperv) / 1000.0 * dt_min / 60.0
        h -= np.minimum(h, f)
        h[h < 1e-4] = 0.0
        h[self.river] = self.river_h
        s["t"] += dt_min
        return {"nodes": res, "runoff_rate": runoff_rate, "runoff_mm": runoff_mm}

    def _route_surface(self, h: np.ndarray, iters: int = 3, alpha: float = 0.22) -> None:
        dem = self.w.dem
        for _ in range(iters):
            eta = dem + h
            pad = np.pad(eta, 1, mode="edge")
            nbrs = [pad[:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, :-2], pad[1:-1, 2:]]
            fl = [alpha * np.maximum(eta - nb, 0) for nb in nbrs]
            tot = sum(fl)
            scale = np.where(tot > h, h / np.maximum(tot, 1e-12), 1.0)
            fl = [f * scale for f in fl]
            h -= sum(fl)
            # deposit to neighbours; open boundaries let water leave the city domain
            up, dn, lf, rt = fl
            h[:-1, :] += up[1:, :]
            h[1:, :] += dn[:-1, :]
            h[:, :-1] += lf[:, 1:]
            h[:, 1:] += rt[:, :-1]
            h[self.river] = self.river_h


def summarize_frame(model: CoupledModel, s: dict, diag: dict, rain: np.ndarray) -> dict:
    """Compact, serialisable frame for timelines."""
    h = s["h"].copy()
    h[model.river] = 0.0
    nodes = diag["nodes"]
    util = {k: round(float(v["util"]), 3) for k, v in nodes.items()}
    states = {k: node_state(v["util"], v["overflow"]) for k, v in nodes.items()}
    return {
        "t": s["t"], "h": h.astype(np.float32), "rain": rain.astype(np.float32),
        "rain_mean": float(rain.mean()), "cum_rain_mm": float(s["cumP"].mean()),
        "runoff_total_m3s": float(diag["runoff_rate"].sum()), "runoff_rate": diag["runoff_rate"].astype(np.float32),
        "cum_runoff_mm": s["cumQ"].astype(np.float32),
        "util": util, "states": states,
        "overflow_m3": {k: round(float(v["overflow"]), 1) for k, v in nodes.items() if v["overflow"] > 0},
        "inflow": {k: round(float(v["inflow"]), 3) for k, v in nodes.items()},
        "outflow": {k: round(float(v["outflow"]), 3) for k, v in nodes.items()},
        "backflow": [k for k, v in nodes.items() if v["backflow"]],
        "storage": {k: round(float(v["storage"]), 2) for k, v in nodes.items()},
        "flooded_cells": int((h >= FLOOD_DEPTH).sum()), "max_depth": float(h.max()),
        "flooded_area_km2": float((h >= FLOOD_DEPTH).sum() * model.A / 1e6),
    }


def run_timeline(model: CoupledModel, rain_fn, t_end: int, state: dict | None = None,
                 keep_states: bool = False) -> tuple[list[dict], list[dict]]:
    s = state if state is not None else model.initial_state()
    frames, states = [], []
    # frame at the start time (no step) — reuse zero-rain diag
    t0 = s["t"]
    first_rain = rain_fn(t0)
    diag0 = {"nodes": {k: {"util": 0.0, "overflow": 0.0, "inflow": 0.0, "outflow": 0.0, "backflow": False, "storage": s["surcharge"].get(k, 0.0)}
                       for k in model.nodes},
             "runoff_rate": np.zeros_like(s["h"])}
    if keep_states:
        states.append(CoupledModel.copy_state(s))
    frames.append(summarize_frame(model, s, diag0, first_rain))
    while s["t"] < t_end - 1e-6:
        rain = rain_fn(s["t"] + DT_MIN / 2)
        diag = model.step(s, rain)
        frames.append(summarize_frame(model, s, diag, rain))
        if keep_states:
            states.append(CoupledModel.copy_state(s))
    return frames, states


def edge_flows(model: CoupledModel, frame: dict) -> list[dict]:
    out = []
    for e in model.w.drain_edges:
        q = frame["outflow"].get(e["from"], 0.0)
        cap = model.pipe_cap[e["from"]]
        area = math.pi * e["diameter_m"] ** 2 / 4
        u = frame["util"].get(e["from"], 0.0)
        out.append({**{k: e[k] for k in ("id", "from", "to", "length_m", "diameter_m", "slope", "capacity_m3s",
                                          "conduit", "adverse_grade", "legacy_undersized", "coords")},
                    "effective_capacity_m3s": round(cap, 3), "flow_m3s": round(q, 3),
                    "velocity_ms": round(min(q / area, 6.0), 2), "utilization": round(u, 3),
                    "status": node_state(u, frame["overflow_m3"].get(e["from"], 0.0)),
                    "bottleneck": bool(u >= 1.0 and (e["legacy_undersized"] or e["adverse_grade"]))})
    return out
