# Simulation: demo storm, event clock and What-If

Sources: `backend/app/engines/rainfall.py` (`StormScenario`), `engines/demo.py` (`DemoClock`),
`engines/simulation.py` (`run_whatif`).

No radar feed is connected, so the platform is driven by a deterministic, radar-like **demo storm**. Everything
derived from it is labelled `SIMULATED_DATA` (current conditions) or `MODEL_PREDICTION` (forecasts).

## Demo storm

### City-mean intensity profile

The storm's city-mean intensity is linearly interpolated between these points:

| Event minute | 0 | 30 | 60 | 90 | 120 | 150 | 180 | 210 | 240 | 300 | 420 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mm/hr | **20** | **40** | **70** | **100** | **120** | 105 | 80 | 45 | 20 | 5 | 0 |

The ramp 20 → 40 → 70 → 100 → 120 mm/hr over the first two hours takes the city from heavy rain to cloudburst-class
intensity. Rain then decays. The demo window is the first **180 minutes**, and the baseline hydraulic run extends to
360 minutes so that +180-minute forecasts issued at the end of the window can be scored.

Accumulated city-mean rainfall is ≈ 42 mm at minute 60, ≈ 85 mm at 90, ≈ 196 mm at 150 and ≈ 290 mm at 240.

### Spatial field

`StormScenario.field(t)` returns a 48 × 48 intensity grid (mm/hr) whose mean equals the profile value:

- a broad Gaussian envelope (σ = 0.38 of the domain) whose centre drifts from the north-west towards the east-south-east
  (row fraction 0.25 → 0.55 and column fraction 0.12 → 0.82 over 300 minutes; about 1.2 km/h at a bearing of ~113°);
- 4 embedded convective cells with seeded offsets, sizes and amplitudes that pulse sinusoidally;
- `observed(t)`, which adds seeded ±6 % multiplicative "measurement" noise to produce the radar-like frames the nowcast
  sees.

The noise-free field is also the "truth" for validation (`demo_truth_reference` in `/api/rainfall/forecast`).

## Event clock

The `DemoClock` in `engines/demo.py` holds the event minute that every endpoint uses when `t` is omitted. A background
task advances it once per second.

| Action (`POST /api/demo`) | Effect |
|---|---|
| `START` | mode `RUNNING`: 0.2 event-min per second (12× real time; one 5-minute step every 25 s) |
| `PAUSE` | mode `PAUSED`: the clock stops |
| `RESET` | minute → 0, mode `PAUSED` |
| `FAST_DEMO` | mode `FAST_DEMO`: `180 / FS_DEMO_SECONDS_TOTAL` event-min per second. With the default of 150 s this is 1.2 event-min/s, so the full **180-minute event plays in ~150 seconds** (one 5-minute step every ~4.2 s). If the clock is already at the end, it restarts from 0. |
| `SEEK` + `minute` | jump to any minute (0–180) |
| `SET_CITY` + `city` | switch the active city; its engine is built on first use (~5 s) |

When the clock reaches minute 180 it pauses. Each time the 5-minute step changes, the clock builds or reads the
snapshot and broadcasts a `tick` over `/api/ws` with KPIs and the top alerts. It also persists the step's predictions,
alerts and drainage events to the database. `GET /api/demo` and `GET /api/health` return the clock status
(`minute`, `t5`, `mode`, `city`, `speed_min_per_sec`, `end_minute`, `progress`).

Staff roles can control the clock (ADMIN, MUNICIPAL_OFFICER, EMERGENCY_RESPONDER, ANALYST); citizens cannot. Clock
state is held in the backend process and resets to minute 0 / PAUSED on restart.

## What-If simulator

`POST /api/simulation` (Staff) runs **two** coupled-model simulations with identical rainfall timing and compares them:

- **BASELINE**: the demo storm with the assumed network condition (per-drain blockage from the maintenance-age model,
  100 % capacity, current imperviousness, 0.5 m river tailwater, dry start).
- **SCENARIO**: the same engine with the parameters below changed.

Both runs cover `duration_min + 60` minutes (capped at 360), and rain stops after `duration_min` in both, so the
comparison isolates the changed parameters.

### Parameters

| Parameter | Range (default) | Effect in the model |
|---|---|---|
| `rainfall_intensity` | 0–400 mm/hr (unset) | Constant city-mean intensity instead of the demo profile (same spatial pattern) |
| `rainfall_multiplier` | 0–5 (1.0) | Scales the profile |
| `duration_min` | 15–300 (180) | Rain stops after this minute |
| `drainage_capacity_pct` | 10–200 (100) | Multiplies every conduit's Manning capacity |
| `blockage_pct` | 0–95 (unset) | Uniform blockage for every node, replacing the assumed per-node values |
| `imperviousness_delta_pct` | −30…+30 (0) | Shifts imperviousness and SCS CN (urbanisation or green infrastructure) |
| `initial_water_level_m` | 0–5 (0.5) | River/outfall tailwater: reduces outfall capacity, raises river head, pre-fills manhole storage |
| `initial_surface_water_m` | 0–0.5 (0) | Ponded water already on the ground (antecedent flooding) |
| `route_from`, `route_to` | [lat, lon] (first fire station → first hospital) | Ambulance route compared in both runs |
| `save`, `name` | (false) | Persist the scenario; export later as CSV or JSON |

### Metrics

For each run, `summary` reports:

| Metric | Definition |
|---|---|
| `max_flood_extent_km2`, `max_flooded_cells` | Peak area with depth ≥ 0.10 m |
| `max_depth_m` | Maximum depth anywhere during the run |
| `affected_roads` | Roads whose max depth reached ≥ 0.15 m |
| `drainage_failures` | Nodes that were OVERLOADED or OVERFLOW at any step |
| `overflowing_nodes` | Nodes that reached OVERFLOW |
| `infrastructure_impacted` | Facilities with site depth ≥ 0.15 m or all access roads > 0.30 m |
| `total_rain_mm`, `peak_runoff_m3s` | Event totals |
| `first_road_flooding_min` | First event minute at which any road is ≥ 0.15 m |
| `flooded_road_hours` | Σ over steps of flooded roads × 5 min |
| `flood_area_km2_hours` | Σ over steps of flooded area × 5 min |

The response also contains `delta` (scenario − baseline for every metric), a one-line `headline`, `diff_cells` (depth
difference grid), `ward_changes` (risk level per ward in each run), `newly_affected_roads`, time series for both
runs, and `route_comparison` (the ambulance route and travel time in each run, and whether the route changed).

### Example: 30 % drainage blockage (Hyderabad, defaults otherwise)

| Metric | Baseline | Scenario (30 % blockage) |
|---|---|---|
| Flood extent (km²) | 5.592 | 5.923 |
| Max depth (m) | 2.54 | 2.61 |
| Affected roads | 22 | 23 |
| Flooded road-hours | 43.2 | 46.2 |
| First road flooding (event min) | 85 | 80 |
| Facilities impacted | 4 | 4 |
| Total rain (mm) | identical in both runs | |

Running with all defaults returns an all-zero `delta` (tested), which confirms that the baseline and scenario paths
are consistent.

The AI Copilot calls the same engine for "What happens at 120 mm/hr?" (constant 120 mm/hr for 120 minutes) and
"What happens with 30% drainage blockage?".
