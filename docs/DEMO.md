# Judging demo script (5–7 minutes)

This walkthrough follows the flood from rainfall to response. The whole event is driven by the **FAST DEMO** clock:
180 event-minutes of the demo storm play in about 150 seconds, and every page updates live over the WebSocket.

> **Say this up front:** FloodShield AI is software-only, with no sensors, IoT or hardware. Rainfall is a simulated
> radar-like storm, and the geography is deterministic demo data. Every number on screen carries a data label
> (`SIMULATED_DATA`, `DEMO_DATA`, `MODEL_PREDICTION`, `USER_REPORTED_DATA`, …).

## Before the judges arrive (checklist)

1. Start the stack: `make docker-up` → http://localhost:8080, or `make dev-backend` + `make dev-frontend` →
   http://localhost:5173.
2. Open http://localhost:8000/api/health. It should return `"status": "ok"`. The first request after startup warms
   the models, which takes a few seconds.
3. Log in once as `officer@floodshield.local` / `Demo@123` to warm caches, then **RESET** the clock.
4. Save the two synthetic CCTV samples for upload (optional segment):
   `/api/cctv/sample?kind=flooded` and `/api/cctv/sample?kind=dry`. These need a logged-in session.
5. Keep a second tab logged in as `citizen@floodshield.local` / `Demo@123` for the citizen view (optional).

If you need to jump to a specific moment, pause the clock and seek. The UI demo controls can do this, or you can call
`POST /api/demo` with `{"action": "SEEK", "minute": 90}`. The storm peaks at 120 mm/hr at minute 120.

## Script

| Time | Page | Do | Point out |
|---|---|---|---|
| 0:00–0:20 | **Login** | Sign in as `officer@floodshield.local` | Role-based access. Five roles, and privileged roles need admin approval (citizens self-register). |
| 0:20–0:50 | **Dashboard (Municipal Command Center)** | Press **FAST DEMO** | The event clock is running (180 min → ~150 s). KPIs update every 5-minute step: rainfall now, cumulative rainfall, flooded roads now and at +60, drainage overload, active alerts, affected facilities. The connection indicator shows ONLINE. |
| 0:50–1:30 | **Rainfall Nowcast** | Show the +15 … +180 horizons | Storm motion from phase correlation (speed and direction), advected rain field, P10–P90 band, heavy-rain probability, and **confidence dropping with lead time**. Anomaly flags appear when the storm crosses 100 mm/hr (cloudburst-class) or intensifies rapidly. The demo profile ramps 20 → 40 → 70 → 100 → 120 mm/hr. |
| 1:30–2:00 | **Terrain & Runoff** | Toggle elevation → flow accumulation → low-lying layers, then runoff | Priority-flood filled DEM, D8 flow paths, low-lying pockets (underpasses and old tank beds), SCS-CN runoff hotspots in L/s/ha, and runoff ratio rising as soils saturate. |
| 2:00–2:40 | **Drainage Network** | Click an overloaded manhole | Node states progress NORMAL → HIGH_LOAD → NEAR_CAPACITY → OVERLOADED → OVERFLOW as rain rises. Show utilisation vs effective capacity, **assumed** blockage (labelled SIMULATED, no sensors), backflow from downstream, and bottleneck conduits (legacy undersized or adverse grade). This is the *drainage–rainfall coupling* at the core of SIH26085. |
| 2:40–3:10 | **Flood Prediction / Live Flood Map** | Pick a road in a red zone | Street-level prediction: depth now, +15 … +180, time-to-flood, duration, passability (e.g. *unsafe for light vehicles → impassable*). |
| 3:10–3:30 | **Flood Prediction** (timeline) | Play the NOW → +180 min animation | Flood zones spreading from low-lying pockets. Extent and max depth are shown for each frame. |
| 3:30–3:55 | **Risk Analysis** | Open the explanation for the highest-risk road or a RED ward | Explainable AI: 12 weighted factors with % contribution, physics overrides, ML susceptibility as a second opinion, and the ward's UFVI. |
| 3:55–4:15 | **Live Flood Map** alerts panel (or Dashboard alerts) | Open a RED alert | Which thresholds triggered it (rain, probability, depth, time-to-flood, drainage), expected time and depth, affected roads and facilities, authority and citizen actions, and the citizen message in **Hindi / Telugu / Tamil / Marathi**. |
| 4:15–4:35 | **Infrastructure** | Filter hospitals | Hospital status (FLOODED / ISOLATED / ACCESS_RESTRICTED / AT_RISK), ambulance reachability %, and the suggested nearest reachable **alternative** hospital. |
| 4:35–5:00 | **Emergency Routing** | Route AMBULANCE from a fire station to a hospital, then switch to NORMAL | The route avoids roads deeper than the mode's safe depth (ambulance 0.30 m, car 0.15 m) using depth now and at +30 min. Compare it with the flood-blind shortest path and its unsafe segments. |
| 5:00–5:30 | **What-If Simulator** | Set **30 % drainage blockage**, run | Baseline vs scenario from the same engine: flood extent, affected roads, flooded road-hours, first flooding time, and ambulance route change. Rainfall is identical in both runs, so the difference comes only from drainage. Optionally save and export as CSV. |
| 5:30–6:15 | **AI Copilot** | Ask 3–4 of: *Which areas will flood in the next hour? · Why is this junction high risk? · Which roads will become unsafe? · Which hospitals are affected? · Which drains are overloaded? · What happens at 120 mm/hr? · What happens with 30% drainage blockage? · Generate a response summary* | Answers are **grounded**: every number comes from the live snapshot or the What-If engine, with event minute, sources, data labels and confidence. There is no free-text generation, and unknown questions get a capability list. |
| 6:15–6:30 | **Emergency & Helplines** | Show the list | **112 is the primary number** and cannot be deleted. National numbers are listed, and local control-room numbers are marked *not verified* until the municipality configures them. The nearest *reachable* hospital, police, fire station and shelter come from flood-safe routing (`/api/nearest-help`). |
| 6:30–7:00 | **Reports** | Download the PDF incident report | Situation summary, vector flood map with safe route, nowcast table, propagation timeline, most affected roads, facilities, drainage failures, alerts and actions, and the validation summary (clearly marked DEMO_VALIDATION). |

## Optional segments (if time allows or judges ask)

- **Citizen Reports**: as the citizen, submit a report with a photo. The image is analysed automatically and the
  report shows *model agreement* (the reported depth compared with the model depth). As the officer, verify it.
- **CCTV Analysis**: upload the flooded and dry samples. Water coverage, vehicle blobs, depth *estimate* and
  severity are shown. Stress that these are estimates from uploaded media, not a live feed.
- **Drain Maintenance**: REPAIR / CLEAN / INSPECT / MONITOR ranking with reasons (P1/P2/P3). No sensors are used:
  the ranking combines utilisation from simulation with an age-based blockage assumption.
- **Historical Analytics**: the synthetic 2006–2025 catalogue, rain–depth relationship and hotspot wards (DEMO_DATA).
- **Incidents**: create an incident from a RED alert and move it OPEN → IN_PROGRESS → RESOLVED.
- **Settings**: switch the UI language (en/hi/te/ta/mr). Alert thresholds can be tuned by admins and officers
  (`PUT /api/alerts/thresholds`); the change takes effect on the next snapshot.
- **Offline**: stop the backend. The frontend switches to DEGRADED/OFFLINE and keeps serving cached data.
- **Validation** (`/api/validation`): flood-extent F1 0.98 at +30 min, 0.93 at +60 min and 0.83 at +120 min. This is a
  twin experiment and is explicitly not real-world validation (see [ML.md](ML.md#validation)).

## Likely judge questions

| Question | Answer |
|---|---|
| Where does the rain come from? | A deterministic radar-like simulation. An Open-Meteo point feed is shown as `LIVE_DATA` for reference only. Radar ingestion (IMD DWR) is the first production integration. |
| Is the city real? | The centres, ward names and street names are real. The DEM, roads, drains and facility positions are deterministic demo data. [GIS.md](GIS.md) documents how to load SRTM/Cartosat, OSM and municipal drainage GIS. |
| How do you know drains are blocked? | We don't. Blockage is an **assumed** value from a maintenance-age model, labelled SIMULATED. The What-If simulator shows how sensitive the flooding is to it. |
| How accurate is it? | Only twin-experiment metrics exist (`DEMO_VALIDATION`). Real-world validation needs radar QPE, SAR flood extents and surveyed depths for the deployment city. |
| Does it need hardware? | No. It needs a server (or Docker) and a browser. |
