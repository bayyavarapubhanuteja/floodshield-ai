"""Rainfall: deterministic storm simulation (when live radar is unavailable) and an AI
nowcasting engine.

Nowcasting method (pySTEPS-inspired, fully transparent):
  1. Motion field: FFT phase-correlation between the last two radar-like frames.
  2. Semi-Lagrangian advection of the latest field along the motion vector.
  3. Growth/decay: damped linear trend of area-mean intensity.
  4. ML correction: gradient-boosted regressor trained on a library of *synthetic*
     storms (never on the demo storm itself) predicts the intensity ratio at each lead.
  5. 16-member ensemble (perturbed motion & growth) -> heavy-rain probability & confidence.
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from scipy.ndimage import gaussian_filter, shift as nd_shift

from app.engines.world import get_world

HORIZONS = [15, 30, 45, 60, 90, 120, 180]
STEP = 5
DEFAULT_PROFILE = [(0, 20), (30, 40), (60, 70), (90, 100), (120, 120), (150, 105), (180, 80),
                   (210, 45), (240, 20), (300, 5), (420, 0)]
HEAVY_THRESHOLD = 50.0  # mm/hr


def classify(i: float) -> str:
    if i < 0.1:
        return "NO RAIN"
    if i < 2.5:
        return "LIGHT"
    if i < 10:
        return "MODERATE"
    if i < 50:
        return "HEAVY"
    if i < 100:
        return "VERY HEAVY"
    return "EXTREME (cloudburst-class ≥100 mm/hr)"


class StormScenario:
    """Spatio-temporal rainfall field I(r, c, t) in mm/hr. City-mean follows `profile`."""

    def __init__(self, city: str, profile=None, multiplier: float = 1.0, duration: int | None = None,
                 fixed_intensity: float | None = None):
        self.city = city
        self.w = get_world(city)
        self.profile = profile or DEFAULT_PROFILE
        self.multiplier = multiplier
        self.duration = duration
        self.fixed = fixed_intensity
        n = self.w.n
        self.yy, self.xx = np.mgrid[0:n, 0:n].astype(float)
        rng = np.random.default_rng(self.w.meta["seed"] + 99)
        self.cells = [(rng.uniform(-0.25, 0.25) * n, rng.uniform(-0.25, 0.25) * n, rng.uniform(2.5, 4.0),
                       rng.uniform(0.3, 0.6), rng.uniform(0, 2 * math.pi)) for _ in range(4)]

    def mean_intensity(self, t: float) -> float:
        if self.duration is not None and t > self.duration:
            return 0.0
        if self.fixed is not None:
            return self.fixed
        ts = [p[0] for p in self.profile]
        vs = [p[1] for p in self.profile]
        return float(np.interp(t, ts, vs)) * self.multiplier

    def center(self, t: float) -> tuple[float, float]:
        n = self.w.n
        f = np.clip(t / 300.0, 0, 1.2)
        return (0.25 + 0.30 * f) * n, (0.12 + 0.70 * f) * n

    def field(self, t: float) -> np.ndarray:
        n = self.w.n
        m = self.mean_intensity(t)
        if m <= 0:
            return np.zeros((n, n))
        cy, cx = self.center(t)
        sig = 0.38 * n
        shape = 0.5 + 0.9 * np.exp(-((self.yy - cy) ** 2 + (self.xx - cx) ** 2) / (2 * sig * sig))
        for dy, dx, s, a, ph in self.cells:
            amp = a * (0.6 + 0.4 * math.sin(t / 25 + ph))
            shape += amp * np.exp(-((self.yy - cy - dy) ** 2 + (self.xx - cx - dx) ** 2) / (2 * s * s))
        return m * shape / shape.mean()

    def observed(self, t: float) -> np.ndarray:
        """Radar-like observation of the field (seeded measurement noise ±6%)."""
        rng = np.random.default_rng(int(t * 7) + self.w.meta["seed"])
        f = self.field(t)
        return np.clip(f * (1 + rng.normal(0, 0.06, f.shape)), 0, None)


# ---------------------------------------------------------------------------------
def phase_correlation(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Displacement (dy, dx) such that b ≈ shift(a, (dy, dx))."""
    if a.max() <= 0 or b.max() <= 0:
        return 0.0, 0.0
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fa, fb = np.fft.fft2((a - a.mean()) * win), np.fft.fft2((b - b.mean()) * win)
    r = fb * np.conj(fa)
    r /= np.abs(r) + 1e-9
    corr = np.fft.ifft2(r).real
    py, px = np.unravel_index(np.argmax(corr), corr.shape)
    n, m = corr.shape

    def sub(c, i, size):
        l, cc, rr = c[(i - 1) % size], c[i], c[(i + 1) % size]
        d = l - 2 * cc + rr
        return 0.0 if d == 0 else 0.5 * (l - rr) / d
    dy = py + sub(corr[:, px], py, n)
    dx = px + sub(corr[py, :], px, m)
    if dy > n / 2:
        dy -= n
    if dx > m / 2:
        dx -= m
    return float(dy), float(dx)


def _synthetic_storm_library(k: int = 160, seed: int = 7) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    out = []
    t = np.arange(0, 420, STEP)
    for _ in range(k):
        peak = rng.uniform(10, 160)
        tp = rng.uniform(40, 220)
        rise = rng.uniform(40, 160)
        fall = rng.uniform(40, 200)
        base = rng.uniform(0, 25)
        prof = np.where(t < tp, base + (peak - base) * np.clip(1 - (tp - t) / rise, 0, 1),
                        peak * np.clip(1 - (t - tp) / fall, 0, 1))
        prof = np.clip(prof * (1 + rng.normal(0, 0.05, len(t))), 0, None)
        out.append(prof)
    return out


def _features(series: np.ndarray, i: int, lead: int) -> list[float]:
    cur = series[i]
    p15 = series[max(i - 3, 0)]
    p30 = series[max(i - 6, 0)]
    p60 = series[max(i - 12, 0)]
    return [cur, cur - p15, cur - p30, cur - p60, lead, (cur - p30) / (cur + 1), (p15 - p30) - (cur - p15)]


@lru_cache(maxsize=1)
def growth_model():
    """Train (or load cached) intensity-ratio regressor. LightGBM/XGBoost if installed, else sklearn."""
    import os
    import pickle
    path = os.path.join(os.path.dirname(__file__), "..", "..", "storage", "models", "nowcast_growth_v2.pkl")
    if os.path.exists(path):
        try:
            with open(path, "rb") as fh:
                return pickle.load(fh)
        except Exception:
            pass
    res = _train_growth_model()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            pickle.dump(res, fh)
    except Exception:
        pass
    return res


def _train_growth_model():
    X, y = [], []
    for prof in _synthetic_storm_library():
        for i in range(0, len(prof) - 36, 3):
            for lead in HORIZONS:
                j = i + lead // STEP
                X.append(_features(prof, i, lead))
                y.append((prof[j] + 1) / (prof[i] + 1))
    X, y = np.array(X), np.array(y)
    name = "sklearn.GradientBoostingRegressor"
    try:
        import lightgbm as lgb  # noqa: F401
        model = lgb.LGBMRegressor(n_estimators=220, learning_rate=0.05, num_leaves=31, verbose=-1)
        name = "LightGBM"
    except Exception:
        try:
            import xgboost as xgb  # noqa: F401
            model = xgb.XGBRegressor(n_estimators=220, max_depth=5, learning_rate=0.06)
            name = "XGBoost"
        except Exception:
            from sklearn.ensemble import HistGradientBoostingRegressor
            model = HistGradientBoostingRegressor(max_iter=150, learning_rate=0.06, max_depth=6)
            name = "sklearn.HistGradientBoostingRegressor"
    model.fit(X, y)
    return model, name, len(X)


def nowcast(scn: StormScenario, t: float, members: int = 16) -> dict:
    """Nowcast issued at event minute t. Returns 5-min resolution mean fields to +180."""
    model, model_name, _ = growth_model()
    t = float(t)
    hist_t = [max(t - k * STEP, 0) for k in range(12, -1, -1)]
    frames = [scn.observed(tt) for tt in hist_t]
    series = np.array([f.mean() for f in frames])
    latest = frames[-1]
    have_motion = t >= 15
    if have_motion:
        sm = [gaussian_filter(f, 1.5) for f in frames]
        ests = [phase_correlation(sm[-1 - k - 3], sm[-1 - k]) for k in range(0, 4) if t - (k + 3) * STEP >= 0]
        dy, dx = float(np.median([e[0] for e in ests])), float(np.median([e[1] for e in ests]))
    else:
        dy, dx = 0.0, 0.0
    vy, vx = float(np.clip(dy / 15.0, -0.5, 0.5)), float(np.clip(dx / 15.0, -0.5, 0.5))  # cells per minute
    speed_kmh = math.hypot(vy, vx) * scn.w.cell_m * 60 / 1000
    direction = (math.degrees(math.atan2(vx, -vy)) + 360) % 360
    recent = series[-7:]
    slope = np.polyfit(np.arange(len(recent)) * STEP, recent, 1)[0] if recent.max() > 0 else 0.0

    leads = list(range(STEP, 181, STEP))
    feats = np.array([_features(series, len(series) - 1, L) for L in leads])
    ml_ratio = np.clip(model.predict(feats), 0, 4)
    cur = series[-1]
    mean_fc = []
    for L, ratio in zip(leads, ml_ratio):
        trend = max(cur + slope * L * math.exp(-L / 120.0), 0)
        ml = max((cur + 1) * ratio - 1, 0)
        w_ml = min(0.35 + L / 240, 0.8)   # trend dominates short leads, learned growth/decay longer leads
        mean_fc.append((1 - w_ml) * trend + w_ml * ml)
    mean_fc = np.array(mean_fc)
    norm = latest / (latest.mean() + 1e-9) if latest.mean() > 0 else np.ones_like(latest)
    fields = []
    for L, m in zip(leads, mean_fc):
        f = nd_shift(norm, (vy * L, vx * L), order=1, mode="nearest")
        fields.append(f / (f.mean() + 1e-9) * m)

    rng = np.random.default_rng(int(t) + 11)
    ens_means = {h: [] for h in HORIZONS}
    ens_heavy = {h: np.zeros_like(latest) for h in HORIZONS}
    for _ in range(members):
        pv = (vy + rng.normal(0, 0.03 + 0.25 * abs(vy)), vx + rng.normal(0, 0.03 + 0.25 * abs(vx)))
        for h in HORIZONS:
            g = math.exp(rng.normal(0, 0.12 * math.sqrt(h / 15)))
            m = mean_fc[leads.index(h)] * g
            f = nd_shift(norm, (pv[0] * h, pv[1] * h), order=1, mode="nearest")
            f = f / (f.mean() + 1e-9) * m
            ens_means[h].append(m)
            ens_heavy[h] += (f >= HEAVY_THRESHOLD)
    horizons = []
    acc = 0.0
    prev_t, prev_i = 0, cur
    for L, m in zip(leads, mean_fc):
        acc += (prev_i + m) / 2 * (L - prev_t) / 60
        prev_t, prev_i = L, m
        if L in HORIZONS:
            e = np.array(ens_means[L])
            spread = float(e.std() / (e.mean() + 1))
            conf = float(np.clip(0.97 - L / 520 - spread * 0.6 - (0 if have_motion else 0.1), 0.35, 0.97))
            pheavy = ens_heavy[L] / members
            horizons.append({
                "horizon_min": L, "intensity_mm_hr": round(float(m), 1),
                "p10_mm_hr": round(float(np.percentile(e, 10)), 1), "p90_mm_hr": round(float(np.percentile(e, 90)), 1),
                "max_cell_mm_hr": round(float(fields[leads.index(L)].max()), 1),
                "accumulation_mm": round(acc, 1), "heavy_rain_probability": round(float((e >= HEAVY_THRESHOLD).mean()), 2),
                "heavy_rain_area_pct": round(float((pheavy >= 0.5).mean() * 100), 1),
                "category": classify(float(m)), "confidence": round(conf, 2),
            })
    clim = 12.0  # monsoon hourly-intensity climatology (demo reference, mm/hr)
    z = (cur - clim) / 10.0
    anomalies = []
    if cur >= 100:
        anomalies.append("Cloudburst-class intensity (≥100 mm/hr) observed")
    if slope * 60 > 40:
        anomalies.append(f"Rapid intensification: +{slope*60:.0f} mm/hr per hour")
    if z > 3:
        anomalies.append(f"Intensity {z:.1f}σ above monsoon climatology")
    return {
        "issued_at_min": t, "model": f"Phase-correlation advection + damped trend + {model_name} ratio model (16-member ensemble)",
        "current_mean_mm_hr": round(float(cur), 1), "trend_mm_hr_per_hr": round(float(slope * 60), 1),
        "storm_motion": {"speed_kmh": round(speed_kmh, 1), "direction_deg": round(direction, 0),
                         "vector_cells_per_min": [round(vy, 4), round(vx, 4)], "estimated": have_motion},
        "horizons": horizons, "anomalies": anomalies, "anomaly_zscore": round(float(z), 2),
        "_fields": fields, "_leads": leads,
    }


def field_cells(city: str, grid: np.ndarray, min_val: float = 0.5) -> list[dict]:
    w = get_world(city)
    out = []
    for r in range(w.n):
        for c in range(w.n):
            v = float(grid[r, c])
            if v >= min_val:
                out.append({"r": r, "c": c, "v": round(v, 1), "bounds": w.cell_bounds(r, c)})
    return out
