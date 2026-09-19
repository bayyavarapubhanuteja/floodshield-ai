# Models and AI

This document describes every model in FloodShield AI, how it was trained, and how it is evaluated. All
training data is synthetic, and the validation below is a twin experiment (`DEMO_VALIDATION`), **not** real-world
validation.

- [Rainfall nowcasting](#rainfall-nowcasting)
- [Flood risk engine](#flood-risk-engine)
- [ML flood-susceptibility model](#ml-flood-susceptibility-model)
- [Urban Flood Vulnerability Index (UFVI)](#urban-flood-vulnerability-index-ufvi)
- [Early-warning rules](#early-warning-rules)
- [Computer-vision pipeline](#computer-vision-pipeline)
- [AI Copilot grounding](#ai-copilot-grounding)
- [Predictive drain maintenance](#predictive-drain-maintenance)
- [Validation](#validation)

---

## Rainfall nowcasting

Source: `backend/app/engines/rainfall.py`. The design follows pySTEPS-style extrapolation nowcasting, with a
learned growth/decay correction and an ensemble. The nowcast is issued at event minute *t* using the last 60 minutes
of radar-like frames: 13 frames at 5-minute spacing, each with ±6 % seeded measurement noise.

### 1. Motion field (phase correlation)

- Frames are smoothed with a Gaussian filter (σ = 1.5 cells).
- For 4 frame pairs 15 minutes apart, the displacement is estimated with FFT **phase correlation**. The fields are
  mean-removed and Hanning-windowed, and the cross-power spectrum is partially (square-root) whitened. The integer
  correlation peak is refined to sub-pixel precision with a parabolic fit.
- The median of the 4 estimates is divided by 15 minutes to give a velocity in cells/min, clipped to ±0.5 cells/min.
  The response reports it as `storm_motion` (speed in km/h and direction in degrees).
- Before *t* = 15 minutes no motion is estimated (`estimated: false`), and confidence is reduced by 0.10.

### 2. Semi-Lagrangian advection

The latest observed field is normalised to unit mean and shifted along the motion vector for every lead time
L = 5 … 180 minutes (`scipy.ndimage.shift`, bilinear, nearest-edge fill). The result is rescaled to the forecast
city-mean intensity. This produces 36 advected fields.

### 3. Damped trend

A linear trend is fitted to the last 7 city-mean values (30 minutes):
`trend(L) = max(I_now + slope · L · e^(−L/120), 0)`. The e-folding time of 120 minutes damps extrapolation at
long leads.

### 4. Gradient-boosted growth/decay model

- **Target:** the intensity ratio `(I(t+L) + 1) / (I(t) + 1)`.
- **Features (7):** current intensity; its change over 15, 30 and 60 minutes; lead time L; relative 30-minute
  change `(I − I₋₃₀)/(I + 1)`; and trend curvature `(I₋₁₅ − I₋₃₀) − (I − I₋₁₅)`.
- **Training data:** a library of **160 synthetic storm hyetographs**. Each has a random peak of 10–160 mm/hr,
  time-to-peak of 40–220 minutes, rise of 40–160 minutes, decay of 40–200 minutes, base of 0–25 mm/hr and 5 % noise,
  over 420 minutes at 5-minute steps. Samples are drawn every 15 minutes at all 7 horizons. The demo storm is **not**
  in the training set.
- **Estimator:** LightGBM (`LGBMRegressor`, 220 trees) if installed, otherwise XGBoost, otherwise scikit-learn
  `HistGradientBoostingRegressor` (150 iterations, learning rate 0.06, max depth 6). The default install uses
  scikit-learn. The trained model is cached at `backend/storage/models/nowcast_growth_v2.pkl`.
- **Blending:** `I(L) = (1 − w)·trend(L) + w·ML(L)`, where `w = min(0.35 + L/240, 0.8)`. The trend dominates short
  leads and the learned growth/decay dominates long leads.

### 5. 16-member ensemble

Each member perturbs the motion vector with Gaussian noise (σ = 0.03 + 0.25·|v| per component) and the
intensity with a log-normal growth factor (σ = 0.12·√(L/15)). For each horizon (15, 30, 45, 60, 90, 120, 180 minutes)
the nowcast reports:

| Field | Definition |
|---|---|
| `intensity_mm_hr` | blended city-mean forecast |
| `p10_mm_hr`, `p90_mm_hr` | ensemble 10th / 90th percentiles |
| `max_cell_mm_hr` | maximum of the advected field |
| `accumulation_mm` | trapezoidal accumulation from now |
| `heavy_rain_probability` | fraction of members with mean ≥ 50 mm/hr |
| `heavy_rain_area_pct` | % of cells where ≥ 50 % of members exceed 50 mm/hr |
| `confidence` | `clip(0.97 − L/520 − 0.6·spread − (0.10 if no motion), 0.35, 0.97)`, where spread = ensemble std / (mean + 1) |
| `category` | NO RAIN < 0.1 · LIGHT < 2.5 · MODERATE < 10 · HEAVY < 50 · VERY HEAVY < 100 · EXTREME (≥ 100 mm/hr, cloudburst-class) |

Confidence decreases with lead time; this is covered by `tests/test_engines.py`. **Anomaly flags** are raised for:
intensity ≥ 100 mm/hr; a trend above +40 mm/hr per hour; and a z-score > 3 against a demo monsoon climatology
(mean 12 mm/hr, σ 10 mm/hr).

The nowcast rainfall fields then drive the coupled hydraulic model for 180 minutes from the current state (see
[HYDRAULICS.md](HYDRAULICS.md)). That run produces the flood forecast.

---

## Flood risk engine

Source: `backend/app/engines/risk.py` and `engines/hub.py`. Every road segment gets an explainable risk score at every
5-minute step.

### Factors and weights

Each factor is normalised to [0, 1]. The score is the weighted sum, and each factor's share of the score is reported
as `contribution_pct`.

| Factor | Weight | Normalisation |
|---|---|---|
| `predicted_depth` | 0.34 | max depth on the road within 60 minutes ÷ 0.6 m |
| `drainage_utilization` | 0.10 | max(utilisation now, +30 min) at connected manholes ÷ 1.5 |
| `low_elevation` | 0.10 | 1 − mean elevation percentile of the road's cells |
| `rainfall_intensity` | 0.08 | mean forecast rain on the road over the next 60 minutes ÷ 120 mm/hr |
| `runoff` | 0.07 | cumulative SCS-CN runoff ÷ 150 mm |
| `historical_flooding` | 0.07 | ward hotspot frequency in the historical catalogue (0–1) |
| `drain_blockage` | 0.05 | assumed blockage of connected nodes ÷ 0.5 |
| `flat_terrain` | 0.05 | 1 − min(mean slope % ÷ 5, 1) |
| `imperviousness` | 0.05 | mean impervious fraction |
| `rain_duration` | 0.03 | 3-hour forecast accumulation ÷ 150 mm |
| `road_vulnerability` | 0.03 | underpass 1.0 · local 0.5 · collector 0.35 · arterial 0.2 |
| `infrastructure_exposure` | 0.03 | critical facilities within ~600 m ÷ 3 |

### Levels and cut-offs

| Level | Score |
|---|---|
| LOW | < 0.35 |
| MODERATE | 0.35 – 0.48 |
| HIGH | 0.48 – 0.60 |
| VERY_HIGH | 0.60 – 0.72 |
| CRITICAL | ≥ 0.72 |

**Physics overrides.** These keep the score consistent with the hydraulic model:

- depth now ≥ 0.8 m → at least CRITICAL
- depth now ≥ 0.5 m or max depth within 60 minutes ≥ 0.6 m → at least VERY_HIGH
- max depth within 60 minutes ≥ 0.3 m → at least HIGH
- max depth within 60 minutes ≥ 0.12 m → at least MODERATE
- max depth over 3 hours < 0.05 m → capped at MODERATE; < 0.15 m → capped at HIGH

**Flood probability** at horizon *h* is `Φ((d_h − 0.15) / σ)`, where
`σ = 0.03 + 0.0009·h + 0.2·d_h·(1 − confidence_h)`. The 0.15 m value is the road-flooded threshold. A road's
**time-to-flood** is the first 5-minute forecast step at which its depth reaches 0.15 m. Each road also gets an
`explanation` sentence that combines depth now and at +60 minutes, probability, time-to-flood, the top 3 factors and
the connected drainage state.

---

## ML flood-susceptibility model

Source: `risk.ml_model()`. This is a second, data-driven opinion that does not see any predicted depth.

- **Estimator:** scikit-learn `GradientBoostingClassifier` (120 trees, max depth 3, learning rate 0.08, random state 0).
- **Training data:** 7 simulated storms. Each has a peak drawn uniformly from 30–150 mm/hr, a triangular-style
  profile, and extra network blockage drawn uniformly from 0–30 %. Each storm is run through the full coupled model
  for 200 minutes, and every road contributes one sample per storm: **1,218 samples** for Hyderabad
  (7 × 174 roads, positive rate 5.5 %).
- **Label:** the road reaches ≥ 0.15 m at any time during the storm.
- **Features (9):** storm peak ÷ 150, extra blockage ÷ 50, low elevation, flat terrain, imperviousness, ward
  historical flooding, road vulnerability, infrastructure exposure, and network centrality (mean road-graph betweenness
  of the two end junctions × 5, capped at 1).
- **Output:** `ml_susceptibility` on each road record. Inference uses the peak of the current nowcast.
  Feature importances are available at `GET /api/risk/model`. For Hyderabad the top features are storm_peak (0.32),
  historical_flooding (0.23) and flat_terrain (0.21).
- **Caveat:** the reported `train_accuracy` (1.0) is measured on the training set. It is not a held-out score and
  should not be read as predictive skill.

---

## Urban Flood Vulnerability Index (UFVI)

Source: `risk.vulnerability_index()`. UFVI is a static composite index (0–1) for each ward that describes exposure and
sensitivity independently of the current storm.

| Component | Weight | Definition |
|---|---|---|
| low_elevation | 0.20 | 1 − mean elevation percentile |
| drainage_deficit | 0.20 | 1 − (ward drain capacity ÷ design demand at 0.8 × design intensity), clipped to [0, 1] |
| imperviousness | 0.15 | mean impervious fraction |
| historical_flooding | 0.15 | ward hotspot frequency |
| flat_terrain | 0.10 | 1 − min(mean slope % ÷ 5, 1) |
| infrastructure_exposure | 0.10 | mean critical-facility exposure ÷ 2 |
| road_connectivity_criticality | 0.10 | mean junction betweenness × 8, capped at 1 |

Classes: VERY_HIGH ≥ 0.60 · HIGH ≥ 0.48 · MODERATE ≥ 0.36 · LOW.

---

## Early-warning rules

Source: `engines/alerts.py`. Each ward is evaluated at every step against five configurable metrics. The worst level
triggered becomes the ward's alert level, and every trigger is reported.

| Metric (ward) | How it is computed | YELLOW | ORANGE | RED |
|---|---|---|---|---|
| `rainfall_mm_hr` | max forecast ward-mean over next 60 minutes | ≥ 30 | ≥ 60 | ≥ 100 |
| `flood_probability` | max road probability at +60 minutes | ≥ 0.30 | ≥ 0.60 | ≥ 0.85 |
| `depth_m` | max road depth over now, +30 and +60 minutes | ≥ 0.10 | ≥ 0.30 | ≥ 0.50 |
| `time_to_flood_min` | earliest road time-to-flood (only counted when that road's probability ≥ 0.5) | ≤ 180 | ≤ 60 | ≤ 30 |
| `drainage_utilization` | 75th percentile of max(utilisation now, +30 minutes) over ward nodes | ≥ 0.90 | ≥ 1.20 | ≥ 1.60 |

Every alert includes authority and citizen action lists for its level, plus citizen messages in en/hi/te/ta/mr.
Thresholds can be changed at runtime through `PUT /api/alerts/thresholds`; the change is held in memory.

---

## Computer-vision pipeline

Source: `engines/vision.py`. The pipeline analyses **uploaded** images and recorded videos; it does not use a live
CCTV feed. Frames are resized so the longest side is at most 640 px.

1. **Road-region prior:** only the lower 45 % of the frame is analysed, on the assumption that the camera looks
   down a street.
2. **Water segmentation (HSV + texture):** a pixel counts as water if it is brownish (H 5–30, S 40–170, V ≥ 50) with
   local variance < 220, or greyish (S < 45, V 60–235) and very smooth (local variance < 45 in a 9 × 9 window).
   Morphological open and close with a 7 × 7 ellipse clean up the mask. The output is `water_coverage_pct` of the
   road region.
3. **Specular reflection ratio:** the share of bright (V > 225), low-saturation (S < 30) pixels inside the water mask.
4. **Vehicles and obstacles:** YOLOv8 (`ultralytics`, weights from `FS_YOLO_WEIGHTS`) is used if it is installed and
   detects car / bus / truck / motorcycle / bicycle / person. Otherwise, Canny edges are dilated and contours are
   filtered by area (1–25 % of the frame), aspect ratio (0.6–4) and position (lower half), up to 12 objects. A vehicle
   counts as "in water" if its bottom quarter is more than 50 % water.
5. **Depth estimate (heuristic, always labelled ESTIMATE):**
   coverage < 8 % → 0 · < 25 % → ~5 cm · < 50 % → ~20 cm · < 75 % → ~40 cm · otherwise > 50 cm.
   If more than half of the detected vehicles have submerged wheels, the estimate is at least 35 cm.
   Severity and passability are derived from the depth, and confidence is heuristic (0.30–0.85).
6. **Video:** up to 24 evenly spaced frames are analysed. The result includes the worst depth, whether any frame
   shows a blocked road, the maximum vehicle count, and the water trend (RISING / RECEDING / STABLE, ±10 %
   coverage between the first and last frame).

The synthetic samples at `GET /api/cctv/sample?kind=flooded|dry` exist for demonstrations and tests. The flooded
sample gives ~74 % water coverage, which the tests assert is higher than the dry sample.

---

## AI Copilot grounding

Source: `engines/copilot.py`. The Copilot does not use a generative language model. It **retrieves and renders**:

1. **Intent classification.** Ordered regular expressions are checked, and the first match wins:
   `whatif_blockage` (e.g. "30% blockage"), `whatif_rain` ("120 mm/hr"), `summary`, `hospitals`, `infrastructure`,
   `drains`, `unsafe_roads`, `why`, `flood_next`, `rain`, `alerts`, `route`. Anything else falls through to `help`.
2. **Entity linking** (for "why" questions). The question is searched for road, drain or junction IDs
   (`R012`, `MH0304`, `J0506`, …), facility names, street names (optionally with a ward name) and ward names. If none
   is found, the Copilot explains the highest-risk road and says so.
3. **Retrieval.** The Copilot reads the same engine snapshot as the dashboard. What-If intents call the What-If
   engine (`run_whatif`).
4. **Rendering.** Answers are Markdown built only from the retrieved values: tables, counts, depths, drivers and
   actions.
5. **Provenance.** Every response carries `grounded: true`, `intent`, `event_minute`, `issued_at`, `data_labels`
   (`MODEL_PREDICTION`, `SIMULATED_DATA` for What-If, plus `DEMO_DATA` for facility answers), `sources`, the nowcast
   confidence, and the structured `data` used to write the answer.

The eight judge questions map as follows (all covered by tests):

| Question | Intent | What the answer contains |
|---|---|---|
| Which areas will flood in the next hour? | `flood_next` | Wards with ORANGE/RED alerts or flooded roads by +60 minutes: level, depth, time-to-flood; roads newly flooding |
| Why is this junction high risk? | `why` | Explanation, top-6 weighted factors with % contribution, risk score, ML susceptibility, confidence |
| Which roads will become unsafe? | `unsafe_roads` | Roads that are not passable at +60 minutes, with depth now → +60 and passability |
| Which hospitals are affected? | `hospitals` | Affected hospitals: status, site depth, ambulance reachability, alternative |
| Which drains are overloaded? | `drains` | Network state counts, overloaded/overflowing nodes, bottleneck conduits |
| What happens at 120 mm/hr? | `whatif_rain` | Baseline vs scenario table for 120 mm/hr × 120 minutes, ambulance route change, wards at higher risk |
| What happens with 30% drainage blockage? | `whatif_blockage` | Baseline vs scenario table for 30 % uniform blockage |
| Generate a response summary | `summary` | Rainfall, flooding, drainage, alerts and infrastructure, plus priority actions |

---

## Predictive drain maintenance

Source: `ops.maintenance()`. Each non-outfall drain node gets a priority score:
`0.25·blockage + 0.15·age + 0.20·peak utilisation + 0.15·history + 0.15·flood contribution + 0.10·structural`.
Each term is normalised: blockage ÷ 0.35, days since cleaning ÷ 240, peak utilisation in the demo storm ÷ 2,
historical failures ÷ 4, mean catchment ponding ÷ 0.4 m, and structural = 1 for legacy undersized conduits or 0.5 for
adverse grade.

The action rules are:

- **REPAIR:** structural issue with high utilisation or failure history.
- **CLEAN:** high blockage, or old with moderate load.
- **INSPECT:** score > 0.35.
- **MONITOR:** everything else.

Priority classes are P1 > 0.55, P2 > 0.40, otherwise P3. No sensors are used.

---

## Validation

Source: `ops.validation()`, `GET /api/validation`. **Validation type: `DEMO_VALIDATION`.**

This is a **twin experiment**. Every 15 minutes from event minute 15 to 180 (12 issue times), the platform issues a
nowcast and a coupled flood forecast from noisy radar-like observations. It then scores them against its own synthetic
"truth": the noise-free storm field and the baseline coupled-model run. This checks internal consistency and shows
how skill degrades with lead time. It says nothing about accuracy against real floods, because the same model family
generates both truth and forecast (the forecast differs only through observation noise, extrapolation and the
growth model).

`real_world_validation.status` is `NOT_AVAILABLE`. Real-world validation would need observed radar QPE (IMD Doppler
weather radar), independent flood extents (e.g. Sentinel-1 SAR, municipal waterlogging logs) and surveyed depth marks
for the deployment city.

### Results (Hyderabad, measured with this build)

**Rainfall nowcast** (city-mean error; cell RMSE compares the advected field with the truth field cell by cell; n = 12
issue times per horizon):

| Horizon | MAE (mm/hr) | RMSE (mm/hr) | Cell RMSE (mm/hr) |
|---|---|---|---|
| +15 min | 3.68 | 4.72 | 5.96 |
| +30 min | 8.89 | 10.19 | 11.47 |
| +45 min | 16.20 | 18.25 | 19.13 |
| +60 min | 22.63 | 25.18 | 25.75 |
| +90 min | 28.01 | 33.93 | 31.31 |
| +120 min | 29.55 | 35.37 | 32.09 |
| +180 min | 20.53 | 22.30 | 21.84 |

For scale, the demo storm peaks at 120 mm/hr. The lower error at +180 minutes than at +120 minutes happens because,
for late issue times, the +180 minute target falls in the storm's decay phase, where intensities are small.

**Flood extent** (cells with depth ≥ 0.10 m, forecast vs truth):

| Horizon | Precision | Recall | F1 | IoU |
|---|---|---|---|---|
| +30 min | 0.982 | 0.983 | 0.983 | 0.966 |
| +60 min | 0.931 | 0.923 | 0.927 | 0.864 |
| +120 min | 0.873 | 0.789 | 0.829 | 0.707 |
| **Overall** | **0.927** | **0.892** | **0.909** | **0.833** |

**Flood depth** (cells that are wet in forecast or truth, pooled over +30, +60 and +120 minutes): **MAE 0.090 m,
RMSE 0.169 m**, n = 5,518 cell-samples.

These numbers are recomputed on demand (cached per process) and are also printed in the PDF incident report.
