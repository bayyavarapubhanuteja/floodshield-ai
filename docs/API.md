# API reference

Base URL: `http://localhost:8000` for local runs, or `http://localhost:8080` in Docker via nginx. Interactive Swagger UI is
at **`/api/docs`**, ReDoc at `/api/redoc` and the OpenAPI schema at `/api/openapi.json`.

## Conventions

- **Authentication.** Send `Authorization: Bearer <access_token>`. Get a token from `POST /api/auth/login` (JSON) or
  `POST /api/auth/token` (OAuth2 password form, used by Swagger's *Authorize* button).
- **Roles.** Auth column values:
  `Public` = no token · `Any` = any logged-in user · otherwise the listed roles. **ADMIN is always allowed.**
  `Staff` = ADMIN, MUNICIPAL_OFFICER, EMERGENCY_RESPONDER, ANALYST.
- **Common query parameters.** `city` is a city key (`hyderabad` [default], `mumbai`, `delhi`, `chennai`, `bengaluru`,
  `visakhapatnam`); if omitted, the demo clock's city is used. `t` is the event minute (0–180, rounded to 5 minutes); if
  omitted, the demo clock's current minute is used.
- **Response metadata.** Snapshot-based responses include `city`, `event_minute`, `issued_at`, `data_label` and `sources`.
- **Grids.** Grids are compact lists of `[row, col, value]` for cells above a threshold, on the `rows × cols` grid
  (48 × 48) inside `bbox = [south, west, north, east]`.
- **Errors** follow FastAPI's `{"detail": ...}` format: 400 invalid input, 401 not authenticated, 403 role not
  permitted, 404 not found, 409 conflict, 413 upload too large, 415 unsupported media type, 422 validation error,
  429 rate limit exceeded.

The example values below come from the Hyderabad demo storm (mostly event minute 90) and are shortened with `…`.
Exact numbers depend on the event minute.

---

## System and demo

| Method | Path | Auth | Parameters | Description |
|---|---|---|---|---|
| GET | `/api/health` | Public | — | Liveness, DB type, Redis status, clock status |
| GET | `/api/demo` | Public | — | Event clock status |
| POST | `/api/demo` | Staff | body `{action, minute?, city?}` | `action` ∈ `START`, `PAUSE`, `RESET`, `FAST_DEMO`, `SEEK` (needs `minute`), `SET_CITY` (needs `city`) |
| GET | `/api/data-quality` | Any | `city`, `check_live` (bool) | Status, completeness, confidence and anomalies for each data source |
| GET | `/api/validation` | Any | `city` | Twin-experiment validation (`DEMO_VALIDATION`), see [ML.md](ML.md#validation) |
| GET | `/api/audit-logs` | ADMIN | `limit` (≤1000) | Recent audit log entries |
| GET | `/api/cities` | Public | — | Available cities |
| WS | `/api/ws` | Public | — | Live event stream (see below) |

```json
// GET /api/health
{"status": "ok", "app": "FloodShield AI", "version": "1.0.0",
 "tagline": "Predict the Flood. Protect the City. Respond Before Impact.",
 "database": "sqlite", "redis": "not configured (in-memory)",
 "clock": {"minute": 0.0, "t5": 0, "mode": "PAUSED", "city": "hyderabad", "speed_min_per_sec": 0.0,
           "end_minute": 180.0, "progress": 0.0, "updated": "2026-09-19T11:25:51+00:00"},
 "hardware_dependencies": "NONE — software-only platform"}

// POST /api/demo {"action": "FAST_DEMO"}
{"minute": 0.0, "t5": 0, "mode": "FAST_DEMO", "city": "hyderabad", "speed_min_per_sec": 1.2,
 "end_minute": 180.0, "progress": 0.0, "updated": "…"}
```

**WebSocket `/api/ws` messages.** The client may send any text as a keep-alive. The server sends:

| `type` | When | Payload |
|---|---|---|
| `hello` | on connect | clock status |
| `clock` | every second, and after `POST /api/demo` | clock status |
| `tick` | when the 5-minute step changes | clock status + `kpis` + `alerts` (≤12: id, level, title, location, expected_time_min, expected_depth_m) |
| `alert_broadcast` | `POST /api/alerts/{id}/notify` with channel WEB | `alert: {id, level, location, language, headline, action}` |
| `citizen_report` | report created or moderated | `report` |
| `incident` | incident updated | `incident` |

---

## Authentication and users

| Method | Path | Auth | Body / params | Description |
|---|---|---|---|---|
| POST | `/api/auth/register` | Public | `{email, full_name, password, role?, department?, phone?, city?, language?}` | Creates a **CITIZEN** account. A privileged `role` (MUNICIPAL_OFFICER / EMERGENCY_RESPONDER / ANALYST) is stored as `requested_role`. `ADMIN` returns 400; an existing e-mail returns 409. Returns tokens (201). |
| POST | `/api/auth/login` | Public | `{email, password}` | Returns access + refresh token and the user |
| POST | `/api/auth/token` | Public | form `username`, `password` | OAuth2 password flow (Swagger) |
| POST | `/api/auth/refresh` | Public | `{refresh_token}` | New token pair |
| GET | `/api/auth/me` | Any | — | Current profile |
| PUT | `/api/auth/me` | Any | `{full_name?, department?, phone?, city?, language? (en/hi/te/ta/mr), theme? (dark/light/system), notify_web?, notify_email?, notify_sms?}` | Update profile and settings |
| POST | `/api/auth/change-password` | Any | `{current_password, new_password}` | |
| POST | `/api/auth/forgot-password` | Public | `{email}` | Always returns 200. Sends a reset token through the e-mail adapter. In `FS_ENV=development` without SMTP, the response includes `dev_reset_token`. |
| POST | `/api/auth/reset-password` | Public | `{token, new_password}` | Single-use token, valid for 30 minutes |
| GET | `/api/auth/roles` | Public | — | Roles, self-registerable roles, permission map |
| GET | `/api/users` | ADMIN | — | List users |
| PATCH | `/api/users/{id}` | ADMIN | `{role?, is_active?}` | Approve or change a role (clears `requested_role`), enable or disable an account |

Password rule: at least 8 characters, containing letters and digits.

```json
// POST /api/auth/login
{"access_token": "eyJhbGciOi…", "refresh_token": "eyJhbGciOi…", "token_type": "bearer",
 "user": {"id": 1, "email": "admin@floodshield.local", "full_name": "System Administrator", "role": "ADMIN",
          "department": "IT & Command Center", "city": "hyderabad", "language": "en", "theme": "dark",
          "notify_web": true, "notify_email": false, "notify_sms": false, "is_active": true,
          "requested_role": null, "created_at": "…"}}
```

---

## Dashboard

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/dashboard` | Any | `city`, `t` | Command-center bundle: `clock`, `kpis`, `nowcast`, `alerts[:10]`, `critical_locations`, `wards`, `facilities_affected`, `history`, `compute_ms` |

```json
// kpis at t=90
{"rain_now_mm_hr": 97.5, "rain_now_max_mm_hr": 164.4, "rain_category": "VERY HEAVY", "rain_cum_mm": 85.0,
 "rain_3h_forecast_mm": 250.4, "rain_peak_forecast_mm_hr": 114.9, "city_risk_level": "CRITICAL",
 "risk_counts": {"LOW": 17, "MODERATE": 129, "HIGH": 13, "VERY_HIGH": 2, "CRITICAL": 13},
 "flooded_roads_now": 2, "flooded_roads_60": 23, "impassable_roads": 0, "total_roads": 174,
 "flooded_area_km2": 1.63, "max_depth_m": 0.93, "max_depth_60_m": 2.17, "drainage_utilization_mean": 1.41,
 "drainage_state_counts": {"NORMAL": 2, "HIGH_LOAD": 6, "NEAR_CAPACITY": 14, "OVERLOADED": 147, "OVERFLOW": 17},
 "drainage_overloaded": 164, "active_alerts": 16, "alert_counts": {"GREEN": 0, "YELLOW": 0, "ORANGE": 3, "RED": 13},
 "affected_facilities": 4, "total_facilities": 37, "worst_ward": "Nampally", "worst_ward_level": "RED",
 "runoff_m3s": 1521.8, "nowcast_confidence_60": 0.66}
```

---

## Rainfall

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/rainfall/current` | Any | `city`, `t`, `include_grid` (default true) | Radar-like observation (`SIMULATED_DATA`): city mean/max, category, cumulative total, per-ward values, grid, history |
| GET | `/api/rainfall/forecast` | Any | `city`, `t`, `horizon` (min, optional) | Nowcast (`MODEL_PREDICTION`) with 7 horizons, storm motion, anomalies, `demo_truth_reference`; with `horizon`, also the advected grid |
| GET | `/api/rainfall/live` | Any | `city` | Open-Meteo point precipitation at the city centre (`LIVE_DATA`, reference only). `status` ∈ ONLINE / OFFLINE / DISABLED. |

```json
// GET /api/rainfall/forecast?t=90 (shortened)
{"data_label": "MODEL_PREDICTION", "issued_at_min": 90.0,
 "model": "Phase-correlation advection + damped trend + sklearn.HistGradientBoostingRegressor ratio model (16-member ensemble)",
 "current_mean_mm_hr": 100.2, "trend_mm_hr_per_hr": 60.2,
 "storm_motion": {"speed_kmh": 0.5, "direction_deg": 95.0, "vector_cells_per_min": [0.0043, 0.0541], "estimated": true},
 "horizons": [{"horizon_min": 15, "intensity_mm_hr": 109.3, "p10_mm_hr": 99.3, "p90_mm_hr": 126.0, "max_cell_mm_hr": 193.7,
               "accumulation_mm": 26.4, "heavy_rain_probability": 1.0, "heavy_rain_area_pct": 100.0,
               "category": "EXTREME (cloudburst-class ≥100 mm/hr)", "confidence": 0.88}, …],
 "anomalies": ["Cloudburst-class intensity (≥100 mm/hr) observed", "Rapid intensification: +60 mm/hr per hour",
               "Intensity 8.8σ above monsoon climatology"],
 "demo_truth_reference": {"label": "SIMULATED_DATA (scenario truth, shown for demo validation only)", "values": […]}}
```

---

## Terrain and runoff

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/terrain` | Any | `city`, `cells` (bool) | Grid meta, stats, land-cover counts/classes, ward terrain stats, method list; with `cells=true`, all 2,304 cells (elevation, slope, aspect, flow dir/acc, catchment, depression, flags) |
| GET | `/api/terrain/layer` | Any | `name`, `city` | One raster layer: `elevation`, `slope`, `aspect`, `flow_accumulation` (log10), `catchment`, `low_lying`, `water_paths`, `depression`, `imperviousness`, `landcover`, `runoff_coefficient` |
| GET | `/api/runoff` | Any | `city`, `t` | SCS-CN runoff: total rate, step volume, runoff ratio, top-10 hotspots (L/s/ha), per-ward runoff, grid (L/s/ha), coefficients, history |

```json
// GET /api/terrain → stats
{"min_elevation_m": 520.0, "max_elevation_m": 558.0, "mean_slope_pct": 0.83, "low_lying_cells": 347,
 "depression_cells": 16, "catchments": 3, "water_path_cells": 154, "mean_imperviousness_pct": 69.8}
```

---

## Drainage

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/drains` | Any | `city`, `t`, `status` | Network summary, all nodes with state, and all conduits with flow, velocity, utilisation, bottleneck flag |
| GET | `/api/drains/{node_id}` | Any | `city`, `t` | Node detail + utilisation/state history to `t` + forecast every 15 min to +180 + outgoing conduit |

```json
// GET /api/drains?t=90 → summary and one node
{"summary": {"nodes": 192, "edges": 186,
             "state_counts": {"NORMAL": 2, "HIGH_LOAD": 6, "NEAR_CAPACITY": 14, "OVERLOADED": 147, "OVERFLOW": 17},
             "mean_utilization": 1.41, "bottlenecks": 37, "backflow_nodes": 148, "total_overflow_m3": 43867.4},
 "nodes": [{"id": "MH0000", "kind": "manhole", "ward": "Ameerpet", "elevation_m": 544.4, "invert_m": 542.4,
            "capacity_m3s": 3.86, "effective_capacity_m3s": 3.146, "inflow_m3s": 6.815, "outflow_m3s": 1.73,
            "utilization": 2.166, "status": "OVERFLOW", "overflow_m3": 20.0, "surcharge": 1.0, "backflow": true,
            "blockage": 0.185, "blockage_label": "ASSUMED (SIMULATED maintenance-age model — no sensors)",
            "status_30": "OVERFLOW", "status_60": "OVERFLOW", "downstream": "MH0100", "upstream": ["IN001"],
            "days_since_cleaning": 193, "historical_failures": 3, "catchment_m2": 358108.3, …}, …],
 "edges": [{"id": "P001", "from": "IN011", "to": "MH0103", "length_m": 305.5, "diameter_m": 1.38, "slope": 0.00439,
            "capacity_m3s": 3.714, "conduit": "pipe", "adverse_grade": false, "legacy_undersized": false,
            "coords": [[17.433561, 78.461687], [17.433633, 78.465224]], "effective_capacity_m3s": 3.034,
            "flow_m3s": 1.669, "velocity_ms": 1.12, "utilization": 1.591, "status": "OVERLOADED", "bottleneck": false}, …]}
```

---

## Flood

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/flood/current` | Any | `city`, `t` | Current depth cells, probability cells, zones, extent, KPIs (`SIMULATED_DATA`) |
| GET | `/api/flood/forecast` | Any | `horizon` (0–180, default 60), `city`, `t` | Forecast depth and probability grid and zones at the horizon |
| GET | `/api/flood/timeline` | Any | `step` (5–60, default 15), `city`, `t` | Frames NOW → +180: depth cells, extent, max depth, rain, overloaded nodes |
| GET | `/api/flood/roads` | Any | `min_risk`, `ward`, `q`, `limit`, `city`, `t` | Street-level records, sorted by risk score |
| GET | `/api/flood/roads/{road_id}` | Any | `city`, `t` | One road + 5-minute forecast series to +180 + history |
| GET | `/api/flood/zones` | Any | `horizon` (0–180), `city`, `t` | GeoJSON `FeatureCollection` of connected flood zones |

```json
// one road record (GET /api/flood/roads)
{"id": "R068", "name": "Necklace Rd (Koti)", "street": "Necklace Rd", "ward": "Koti", "road_class": "local",
 "underpass": false, "coords": [[17.417592, 78.489], …], "length_m": 859.5, "elevation_m": 532.16,
 "depth_now_m": 0.292, "depth_forecast_m": {"15": 0.459, "30": 0.708, "45": 0.924, "60": 1.12, "90": 1.431, "120": 1.611, "180": 1.49},
 "probability": {"15": 1.0, "30": 1.0, …}, "time_to_flood_min": 0, "duration_min": 185, "max_depth_m": 1.643,
 "time_of_max_min": 140, "drainage_status": "OVERFLOW", "drainage_utilization": 1.555, "drain_nodes": ["MH0306", "MH0307"],
 "passability": "UNSAFE_LIGHT_VEHICLES", "passability_60": "IMPASSABLE", "risk_score": 0.874, "risk_level": "CRITICAL",
 "factors": [{"factor": "predicted_depth", "label": "predicted water depth in the next 60 min", "value": 1.0,
              "weight": 0.34, "contribution_pct": 38.9}, …],
 "confidence": 0.66, "ml_susceptibility": 0.99,
 "explanation": "Necklace Rd (Koti): 0.29 m now; forecast 1.12 m at +60 min (flood probability 100%). Already flooded. Main drivers: …",
 "closed": false, "data_label": "MODEL_PREDICTION"}

// one frame (GET /api/flood/timeline)
{"offset_min": 0, "event_minute": 90, "cells": [[6, 0, 0.06], …], "flooded_area_km2": 1.625, "max_depth_m": 0.93,
 "rain_mm_hr": 97.5, "overloaded_nodes": 164, "label": "NOW"}
```

Passability classes by depth: `PASSABLE` < 0.05 m ≤ `PASSABLE_WITH_CAUTION` < 0.15 ≤ `UNSAFE_LIGHT_VEHICLES` < 0.30 ≤
`EMERGENCY_VEHICLES_ONLY` < 0.50 ≤ `IMPASSABLE`.

---

## Risk

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/risk` | Any | `city`, `t` | City level, level counts, wards, weights, level cut-offs, top-20 roads |
| GET | `/api/risk/vulnerability` | Any | `city` | UFVI for each ward, with components and weights |
| GET | `/api/risk/model` | Any | `city` | ML susceptibility model information and feature importances |
| GET | `/api/risk/explain` | Any | `kind` (`road` / `ward` / `drain`), `id`, `city`, `t` | Explainable AI: prediction, confidence, timestamp, sources, factors |

```json
// GET /api/risk/model
{"model": "sklearn GradientBoostingClassifier (flood susceptibility)",
 "trained_on": "7 simulated storms × all roads (SIMULATED_DATA)", "train_samples": 1218, "positive_rate": 0.055,
 "train_accuracy": 1.0, "feature_importances": [{"feature": "storm_peak", "importance": 0.319},
 {"feature": "historical_flooding", "importance": 0.231}, {"feature": "flat_terrain", "importance": 0.212}, …],
 "explainable_weights": {"predicted_depth": 0.34, "drainage_utilization": 0.1, …}}

// GET /api/risk/vulnerability → one ward
{"ward": "Koti", "ward_id": "W07", "ufvi": 0.644, "class": "VERY_HIGH",
 "components": {"low_elevation": 0.805, "flat_terrain": 0.862, "imperviousness": 0.799, "drainage_deficit": 0.0,
                "historical_flooding": 1.0, "infrastructure_exposure": 0.608, "road_connectivity_criticality": 0.665},
 "weights": {"low_elevation": 0.2, "flat_terrain": 0.1, "imperviousness": 0.15, "drainage_deficit": 0.2,
             "historical_flooding": 0.15, "infrastructure_exposure": 0.1, "road_connectivity_criticality": 0.1}}
```

---

## Infrastructure

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/infrastructure` | Any | `kind`, `city`, `t` | Per-kind counts (total/affected) and facilities with status, site depth, access roads, ambulance reachability and alternative |
| GET | `/api/infrastructure/{fid}` | Any | `city`, `t` | One facility |

Facility `status`: `FLOODED` (site ≥ 0.30 m) · `ISOLATED` (ambulance can reach < 30 % of the network) ·
`ACCESS_RESTRICTED` (an access road > 0.30 m, or site ≥ 0.15 m) · `AT_RISK` (same conditions within 60 min) · `OPERATIONAL`.

```json
{"id": "HOS01", "kind": "hospital", "name": "Koti General Hospital", "ward": "Koti", "capacity": 59, "critical": true,
 "site_depth_now_m": 0.09, "site_depth_60_m": 0.72, "status": "AT_RISK", "risk_level": "MODERATE",
 "reachable_network_pct": 97.0, "access_roads": ["R052", "R068", "R070", …], "access_roads_flooded": [],
 "affected_roads": [{"id": "R071", "name": "Himayatnagar Cross Rd (Koti)", "depth_now_m": 0.047, "depth_60_m": 0.598, "distance_m": 298}, …],
 "alternative": {"id": "HOS06", "name": "Tolichowki Urban Health Centre", "travel_time_min": 4.5, "status": "OPERATIONAL",
                 "basis": "ambulance flood-safe travel time"},
 "data_label": "MODEL_PREDICTION", "facility_data_label": "DEMO_DATA"}
```

---

## Alerts and notifications

| Method | Path | Auth | Params / body | Description |
|---|---|---|---|---|
| GET | `/api/alerts/public` | Public | `city`, `lang` (en/hi/te/ta/mr) | Citizen-facing alerts with a localised message |
| GET | `/api/alerts` | Any | `level`, `city`, `t` | Alerts with triggers, actions and 5-language messages; thresholds; counts; ward levels |
| PUT | `/api/alerts/thresholds` | ADMIN, MUNICIPAL_OFFICER | `{"thresholds": {"rainfall_mm_hr": {"YELLOW": 25}, …}}` | Update thresholds (in memory) |
| POST | `/api/alerts/thresholds/reset` | ADMIN, MUNICIPAL_OFFICER | — | Restore defaults |
| POST | `/api/alerts/{alert_id}/notify` | ADMIN, MUNICIPAL_OFFICER, EMERGENCY_RESPONDER | `{channels: ["WEB","EMAIL","SMS"], recipients: [], language}` | WEB broadcasts over WebSocket; EMAIL/SMS go through adapters (`SIMULATED` if not configured) |
| GET | `/api/notifications/outbox` | ADMIN, MUNICIPAL_OFFICER | — | Last 200 deliveries (reset tokens redacted) |

```json
// one alert (GET /api/alerts)
{"id": "HYD-090-W01", "level": "RED", "title": "RED flood alert: Ameerpet", "location": "Ameerpet — Masab Tank Rd",
 "ward": "Ameerpet", "lat": 17.429361, "lon": 78.443617, "expected_time_min": 15, "expected_time": "…",
 "expected_depth_m": 1.0, "flood_probability": 1.0,
 "affected_roads": [{"id": "R021", "name": "Masab Tank Rd (Ameerpet)", "depth_60_m": 1.0},
                    {"id": "R037", "name": "SP Rd (Ameerpet)", "depth_60_m": 1.0}],
 "affected_infrastructure": [],
 "recommended_actions": {"authority": ["Close listed roads and underpasses immediately; activate emergency routing.", …],
                         "citizen": ["Stay indoors or move to the nearest shelter on high ground.", "Call 112 in an emergency.", …]},
 "messages": {"en": {"language": "en", "headline": "SEVERE flood alert: act now — Ameerpet — Masab Tank Rd",
                     "action": "Stay indoors or move to the nearest shelter on high ground. Call 112 in an emergency. …"},
              "hi": {…}, "te": {…}, "ta": {…}, "mr": {…}},
 "triggers": [{"metric": "rainfall_mm_hr", "value": 129.7, "threshold": 100, "level": "RED"},
              {"metric": "flood_probability", "value": 1.0, "threshold": 0.85, "level": "RED"},
              {"metric": "depth_m", "value": 1.0, "threshold": 0.5, "level": "RED"},
              {"metric": "time_to_flood_min", "value": 15, "threshold": 30, "level": "RED"},
              {"metric": "drainage_utilization", "value": 1.91, "threshold": 1.6, "level": "RED"}],
 "confidence": 0.66, "issued_at": "…", "event_minute": 90, "data_label": "MODEL_PREDICTION"}
```

---

## Map layers

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/map/static` | Any | `city` | Static GIS (`DEMO_DATA`): centre, bbox, grid, wards, roads (polylines), junctions, drain nodes/edges, infrastructure, analysis cameras, river cells |
| GET | `/api/map/dynamic` | Any | `horizon` (0–180), `city`, `t` | Dynamic overlays at NOW or a forecast horizon: rain, accumulated rain, runoff, depth, probability, zones, road/drain/facility/ward states, KPIs |

---

## Emergency routing and help

| Method | Path | Auth | Params / body | Description |
|---|---|---|---|---|
| GET | `/api/routes/modes` | Any | — | Modes with `max_depth`, `speed_factor`, `risk_weight` |
| POST | `/api/routes` | Any | `{origin: [lat,lon], destination: [lat,lon], mode, closures: [road_id], city?, t?}` | Recommended route, up to 2 alternatives, flood-blind shortest path for comparison, status/message |
| POST | `/api/routes/closures` | ADMIN, MUNICIPAL_OFFICER, EMERGENCY_RESPONDER | `{road_id, closed}` + `city` | Manual road closure (in memory; affects routing and snapshots) |
| GET | `/api/nearest-help` | Any | `lat`, `lon`, `kinds` (default `hospital,police,fire_station,shelter`), `city` | Nearest *reachable* facility of each kind, with route (hospital → AMBULANCE, shelter → PEDESTRIAN, others → EMERGENCY) and `emergency_number: "112"` |

Modes: `NORMAL` 0.15 m · `AMBULANCE` 0.30 m · `FIRE` 0.60 m · `POLICE` 0.30 m · `EMERGENCY` 0.45 m ·
`PUBLIC_TRANSPORT` 0.30 m · `PEDESTRIAN` 0.10 m (maximum safe depth).

```json
// POST /api/routes {"origin": [...], "destination": [...], "mode": "AMBULANCE"}
{"city": "hyderabad", "event_minute": 120, "mode": "AMBULANCE", "mode_label": "Ambulance", "max_safe_depth_m": 0.3,
 "origin_node": "J0101", "destination_node": "J0807", "status": "OK",
 "message": "Shortest route is currently flood-safe for this mode.",
 "recommended": {"nodes": ["J0101", "J0201", …], "coords": [[17.432587, 78.449931], …], "distance_km": 10.61,
                 "time_min": 12.4, "max_depth_m": 0.04, "flooded_segments": 0, "unsafe_segments": 0, "exposure_m2": 152.5,
                 "risk_level": "MODERATE", "safe_for_mode": true,
                 "segments": [{"road_id": "R023", "name": "Somajiguda Rd (Ameerpet)", "depth_m": 0.04, "risk_level": "MODERATE",
                               "passable": true, "length_m": 888.0}, …]},
 "alternatives": […], "shortest_ignoring_flood": {…}, "data_label": "MODEL_PREDICTION"}
```

If no safe path exists, the response has `status: "NO_SAFE_ROUTE"`, `recommended: null` and a message suggesting
higher-clearance resources.

---

## What-If simulator

| Method | Path | Auth | Body / params | Description |
|---|---|---|---|---|
| POST | `/api/simulation` | Staff | see below | Runs baseline and scenario (about 1 s) |
| GET | `/api/simulation` | Any | `city` | Last 50 saved scenarios |
| GET | `/api/simulation/{id}` | Any | — | Saved scenario |
| GET | `/api/simulation/{id}/export` | Any | `fmt` = `csv` (default) / `json` | Download |

Body (all fields optional): `rainfall_intensity` (0–400 mm/hr constant; omit to use the demo profile),
`rainfall_multiplier` (0–5), `duration_min` (15–300, default 180), `drainage_capacity_pct` (10–200),
`blockage_pct` (0–95 uniform; omit to use the assumed per-drain value), `imperviousness_delta_pct` (−30…30),
`initial_water_level_m` (river tailwater 0–5, default 0.5), `initial_surface_water_m` (0–0.5),
`route_from` / `route_to` ([lat, lon]), `city`, `name`, `save`.

```json
// POST /api/simulation {"blockage_pct": 30}
{"data_label": "SIMULATED_DATA", "horizon_min": 240,
 "baseline": {"label": "BASELINE (demo storm, assumed network condition)",
              "summary": {"max_flood_extent_km2": 5.592, "max_depth_m": 2.54, "affected_roads": 22, "drainage_failures": 184,
                          "flooded_road_hours": 43.2, "first_road_flooding_min": 85, "infrastructure_impacted": 4, …},
              "affected_road_ids": […], "failed_nodes": […], "infrastructure": […], "wards": {…}, "series": […]},
 "scenario": {"label": "SCENARIO", "summary": {"max_flood_extent_km2": 5.923, "max_depth_m": 2.61, "affected_roads": 23,
              "flooded_road_hours": 46.2, "first_road_flooding_min": 80, …}, …},
 "delta": {"max_flood_extent_km2": 0.331, "affected_roads": 1, "flooded_road_hours": 3.0, "first_road_flooding_min": -5,
           "total_rain_mm": 0.0, …},
 "headline": "Scenario vs baseline: flood extent 5.592→5.923 km², max depth 2.54→2.61 m, affected roads 22→23, …",
 "diff_cells": [[r, c, delta_m, scenario_m], …], "ward_changes": […], "newly_affected_roads": […],
 "route_comparison": {"mode": "AMBULANCE", "baseline": {"status": "OK", "time_min": …}, "scenario": {…}, "changed": false}}
```

---

## Citizen reports

| Method | Path | Auth | Body / params | Description |
|---|---|---|---|---|
| POST | `/api/citizen-report` | Any | multipart: `lat`, `lon`, `estimated_depth_cm` (0–300), `road_condition` (PASSABLE/WATERLOGGED/FLOODED/BLOCKED/IMPASSABLE), `description`, `language`, `city`, `photo` (JPEG/PNG/WebP) | Creates an `UNVERIFIED` report. A photo is analysed automatically, and the report is broadcast on WebSocket. |
| GET | `/api/citizen-report` | Any | `status`, `mine`, `city` | Reports with `model_depth_m` and `model_agreement` (AGREES / REPORT_HIGHER / REPORT_LOWER, ±20 cm). Citizens see their own reports plus verified ones. |
| PATCH | `/api/citizen-report/{id}` | ADMIN, MUNICIPAL_OFFICER, EMERGENCY_RESPONDER | `{status, note}` | Moderate (VERIFIED / UNVERIFIED / UNDER_REVIEW / RESOLVED) |
| GET | `/api/uploads/{name}` | Public | — | Serves an uploaded file (server-generated name) |

---

## CCTV and image analysis

| Method | Path | Auth | Body / params | Description |
|---|---|---|---|---|
| POST | `/api/image-analysis` | Any | multipart `file` (image), `lat`, `lon`, `camera_id`, `city` | Water coverage, reflections, vehicles, depth *estimate*, severity, passability |
| POST | `/api/video-analysis` | Staff | multipart `file` (MP4/MOV/AVI/WebM), … | Samples up to 24 frames: timeline, worst depth, water trend (RISING / RECEDING / STABLE) |
| GET | `/api/cctv` | Any | `city` | Analysis camera locations + last 100 analysed media |
| GET | `/api/cctv/sample` | Any | `kind` = `flooded` / `dry` | Synthetic sample JPEG for demonstrations |

```json
// POST /api/image-analysis (synthetic flooded sample)
{"file_id": 1, "file_url": "/api/uploads/20260919112602_01b62caf90a8d605.jpg", "water_detected": true,
 "water_coverage_pct": 74.1, "reflection_ratio": 0.0, "flooded_road": true, "vehicles_detected": 2, "stranded_vehicles": 0,
 "road_blocked": true, "traffic": "LIGHT", "passability": "EMERGENCY_VEHICLES_ONLY", "severity": "HIGH",
 "estimated_depth_m": 0.4, "estimated_depth_band": "30–50 cm (unsafe for cars)", "confidence": 0.63,
 "detector": "OpenCV contour heuristic", "detections": [{"label": "vehicle/obstacle (heuristic)", "box": [307, 187, 524, …],
 "confidence": 0.4, "lower_part_in_water": false}, …], "is_estimate": true, "data_label": "USER_REPORTED_DATA",
 "disclaimer": "Depth and severity are computer-vision ESTIMATES from uploaded media, not measurements."}
```

---

## Historical analytics and drain maintenance

| Method | Path | Auth | Params / body | Description |
|---|---|---|---|---|
| GET | `/api/historical` | Any | `city` | Synthetic catalogue 2006–2025 (`DEMO_DATA`): events, by year and month, rain–depth regression, hotspot wards, most frequently flooded roads |
| GET | `/api/maintenance` | Any | `action`, `city` | Ranked REPAIR / CLEAN / INSPECT / MONITOR recommendations with reasons and `work_status` |
| PATCH | `/api/maintenance/{node_id}` | ADMIN, MUNICIPAL_OFFICER | `{status}` (PENDING / SCHEDULED / IN_PROGRESS / DONE) | Track work |

```json
// GET /api/maintenance → first recommendation
{"node_id": "MH0201", "kind": "junction", "ward": "Ameerpet", "action": "REPAIR", "priority_score": 0.706, "priority": "P1",
 "reasons": ["peak utilisation 215% in design storm", "4 historical failures", "legacy undersized conduit"],
 "assumed_blockage": 0.159, "days_since_cleaning": 193, "peak_utilization": 2.15, "historical_failures": 4,
 "flood_contribution_m": 0.059, "data_label": "MODEL_PREDICTION",
 "basis": "Utilisation from simulation + maintenance-age blockage assumption (no sensors)", "work_status": "PENDING"}
```

---

## Emergency contacts

| Method | Path | Auth | Body / params | Description |
|---|---|---|---|---|
| GET | `/api/emergency-contacts` | Public | `city` | National numbers (112 primary first) + the city's local entries |
| POST | `/api/emergency-contacts` | ADMIN, MUNICIPAL_OFFICER | `{city, category, name, number, description, verified, sort_order}` | Add |
| PUT | `/api/emergency-contacts/{id}` | ADMIN, MUNICIPAL_OFFICER | same | Edit |
| DELETE | `/api/emergency-contacts/{id}` | ADMIN | — | Delete (the primary number cannot be deleted) |

```json
{"city": "hyderabad", "primary": "112",
 "note": "National numbers are pan-India (some state services vary). Local numbers must be configured and verified by the municipality.",
 "contacts": [{"id": 1, "city": "national", "category": "EMERGENCY", "name": "National Emergency Response (ERSS)", "number": "112",
               "description": "Single emergency number — police, fire, ambulance", "verified": true, "primary": true, "sort_order": 1},
              {"id": 2, "category": "POLICE", "name": "Police", "number": "100", …}, …]}
```

Seeded national numbers: 112, 100, 101, 108, 102, 1070, 1077, 1078, 1073, 1912, 1098, 181, 1091, 139. The seed also
creates eight local entries per city (municipal, collectorate, DDMA, hospital casualty, police, fire, traffic,
electricity) with an empty number and `verified: false`.

---

## AI Copilot

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/api/copilot` | Any | `{question (2–500 chars), city?, t?}` | Grounded answer (Markdown) with `intent`, `data`, `confidence`, `event_minute`, `issued_at`, `data_labels`, `sources`, `grounded: true` |

```json
// POST /api/copilot {"question": "Which hospitals are affected?"}
{"question": "Which hospitals are affected?", "intent": "hospitals",
 "answer": "**2 of 6 hospitals affected** (facility locations are DEMO data):\n- **Koti General Hospital** (hospital): FLOODED, site depth 0.37 m (+60: 1.11 m), ambulance reach 0.0% → alternative: Himayatnagar Multi-speciality Hospital\n- …",
 "data": {"facilities": […]}, "confidence": 0.66, "grounded": true, "event_minute": 120, "issued_at": "…",
 "data_labels": ["MODEL_PREDICTION", "DEMO_DATA"],
 "sources": ["Coupled flood engine snapshot", "Rainfall nowcast", "Drainage digital twin"]}
```

See [ML.md](ML.md#ai-copilot-grounding) for the list of intents.

---

## Incidents

| Method | Path | Auth | Body / params | Description |
|---|---|---|---|---|
| GET | `/api/incidents` | Any | `status`, `city` | Incidents + counts by status |
| POST | `/api/incidents` | Staff | `{title, location, lat, lon, severity, department, affected_roads, affected_infrastructure, recommended_actions, city}` | Create (`OPEN`, ID like `INC-HYD-260919-0002`) |
| POST | `/api/incidents/from-alert/{alert_id}` | Staff | `city` | Create from a live alert (severity and department mapped from the alert level) |
| PATCH | `/api/incidents/{id}` | Staff | `{status?, department?, severity?, note?}` | Status ∈ OPEN / ACKNOWLEDGED / IN_PROGRESS / RESOLVED; appends a note; broadcasts on WebSocket |

---

## Reports

| Method | Path | Auth | Params | Description |
|---|---|---|---|---|
| GET | `/api/reports/incident.pdf` | Any | `city`, `t`, `route_mode` (default AMBULANCE) | A4 PDF: situation summary, vector flood map with safe route, nowcast, propagation timeline, most affected roads, facilities, drainage failures, alerts and actions, emergency route (fire station → hospital), validation summary, helplines |

The response is `application/pdf` with `Content-Disposition: attachment; filename=FloodShield_Hyderabad_T090.pdf`.
