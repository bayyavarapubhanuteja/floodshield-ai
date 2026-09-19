# Deployment

## Docker compose

`docker-compose.yml` defines exactly four services:

| Service | Image / build | Port | Notes |
|---|---|---|---|
| `frontend` | `frontend/Dockerfile`: `node:20-alpine` build (`npm ci && npm run build`, build arg `VITE_API_URL`, empty by default) → `nginx:alpine` | `8080:80` | Serves the SPA with history fallback. Reverse-proxies `/api/` and `/api/ws` (WebSocket upgrade) to `http://backend:8000`. `client_max_body_size 50m`. |
| `backend` | `backend/Dockerfile`: `python:3.11-slim` + `libgl1`, `libglib2.0-0`, `libgomp1` | `8000:8000` | `uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers`. Runs as a non-root user and has a healthcheck on `/api/health`. The `backend-storage` volume keeps `/app/storage` (uploads and the cached nowcast model). |
| `db` | `postgis/postgis:16-3.4` | internal | Healthcheck `pg_isready`, volume `pgdata` |
| `redis` | `redis:7-alpine` (AOF on) | internal | Healthcheck `redis-cli ping`, volume `redisdata` |

```bash
cp .env.example .env              # then edit secrets (see below)
docker compose up -d --build      # or: make docker-up
docker compose logs -f backend    # first start: create tables + PostGIS extension, seed, warm engine (~10–20 s)
open http://localhost:8080        # API docs: http://localhost:8000/api/docs
docker compose down               # or: make docker-down   (add -v to delete volumes)
```

Start-up order: `db` and `redis` become healthy, then `backend` starts and becomes healthy, then `frontend` starts.
On first start the backend creates all tables, runs `CREATE EXTENSION IF NOT EXISTS postgis`, seeds the demo users,
helplines, GIS tables and demo activity, and warms the default city's engine.

To seed all six cities: `docker compose exec backend python -m scripts.seed --all-cities`.

The frontend calls relative `/api/...` URLs, so the default empty `VITE_API_URL` is correct behind nginx. Set it
(e.g. `VITE_API_URL=https://api.example.org docker compose build frontend`) only if the API is served from a
different origin, and then add that frontend origin to `FS_CORS_ORIGINS`.

Notes:
- The frontend image installs dependencies in a separate directory, so a host `node_modules/` in the build context
  cannot shadow them. A `frontend/.dockerignore` listing `node_modules` and `dist` is still recommended, because it
  keeps the build context small.
- If `postgis/postgis:16-3.4` has no native image for your CPU architecture (e.g. some ARM hosts), add
  `platform: linux/amd64` to the `db` service to run it under emulation.

## Environment variables

The backend reads `FS_*` variables (pydantic-settings; a `.env` file in the working directory is also read).
docker compose passes the values below. Defaults come from `backend/app/core/config.py` unless noted.

| Variable | Default | Purpose |
|---|---|---|
| `FS_ENV` | `development` | In `development` without SMTP, `forgot-password` returns `dev_reset_token`. **Set `production` in production.** |
| `FS_SECRET_KEY` | `change-me-in-production-floodshield` | JWT signing key (HS256). **Must be changed.** |
| `FS_DATABASE_URL` | `sqlite:///./floodshield.db` | Compose sets `postgresql+psycopg2://floodshield:<POSTGRES_PASSWORD>@db:5432/floodshield` |
| `FS_REDIS_URL` | empty (in-memory limiter) | Compose sets `redis://redis:6379/0` |
| `FS_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173` | Comma-separated. Compose sets `http://localhost:5173,http://localhost:8080`. |
| `FS_RATE_LIMIT_PER_MINUTE` | `240` | Requests per client IP per minute on `/api/*` (WebSocket exempt) |
| `FS_ACCESS_TOKEN_MINUTES` / `FS_REFRESH_TOKEN_DAYS` | `480` / `7` | Token lifetimes |
| `FS_UPLOAD_DIR` / `FS_MAX_UPLOAD_MB` | `./storage/uploads` / `50` | Media uploads |
| `FS_DEFAULT_CITY` | `hyderabad` | Initial clock city and seeded city |
| `FS_GRID_SIZE` | `48` | Model grid (n × n). Runtime grows with the number of cells. |
| `FS_SEED_ADMIN_PASSWORD` | `Admin@123` | Password given to `admin@floodshield.local` on first seed |
| `FS_DEMO_SECONDS_TOTAL` | `150` | Real seconds for FAST_DEMO to play 180 event-minutes |
| `FS_WEATHER_PROVIDER` | `simulated` | `disabled` turns off the Open-Meteo reference feed; any other value allows `/api/rainfall/live` to query Open-Meteo (no key). The model is always driven by the simulated storm. |
| `FS_SMTP_HOST` | empty | SMTP host for e-mail alerts and password reset (sender `alerts@floodshield.local`, no auth/TLS options in this build). Empty means deliveries are logged as `SIMULATED`. |
| `FS_SMS_GATEWAY_URL` | empty | HTTP endpoint that receives `POST {"to", "text"}`. Empty means `SIMULATED`. |
| `FS_YOLO_WEIGHTS` | empty (`yolov8n.pt` if `ultralytics` is installed) | Optional YOLO weights for CCTV analysis |
| `POSTGRES_PASSWORD` | `floodshield` | Compose only: database password used by both `db` and `backend` |
| `VITE_API_URL` | empty | Compose build arg for the frontend |

## Production hardening

**Secrets and mode**
- Generate a strong key: `FS_SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(64))")`.
  Changing it invalidates all issued tokens.
- Set `FS_ENV=production` so password-reset tokens are never returned in API responses, and configure `FS_SMTP_HOST`
  so reset e-mails are actually delivered.
- Change `POSTGRES_PASSWORD` and `FS_SEED_ADMIN_PASSWORD` **before the first start**, because the seed only runs on an
  empty database. Log in and change the demo passwords, or deactivate the demo accounts with
  `PATCH /api/users/{id} {"is_active": false}`.

**HTTPS and network**
- Put a TLS-terminating proxy in front of the `frontend` service, or add a `listen 443 ssl` server block to
  `frontend/nginx.conf` with your certificates, and redirect HTTP to HTTPS. The SPA then uses `wss://` for `/api/ws`
  through the same proxy.
- Do not publish `backend:8000` publicly in production. Remove its `ports:` mapping so it is reachable only through
  nginx. The database and Redis are already internal-only.
- Add `Strict-Transport-Security` and a Content-Security-Policy at the edge proxy.

**CORS**
- Set `FS_CORS_ORIGINS` to the exact public origin(s), e.g. `https://floodshield.city.gov.in`. The same-origin nginx
  setup needs no extra origins.

**PostgreSQL backups**
- Take logical backups on a schedule:
  `docker compose exec -T db pg_dump -U floodshield -Fc floodshield > backup_$(date +%F).dump`
- Restore with:
  `docker compose exec -T db pg_restore -U floodshield -d floodshield --clean < backup.dump`
- Keep backups off-host and test restores. For point-in-time recovery, use a managed PostgreSQL service or WAL
  archiving (e.g. pgBackRest or WAL-G).
- There is no migration tool. Tables are created with `create_all`, so review schema changes manually before upgrading
  a populated database.

**Redis and rate limiting**
- When `FS_REDIS_URL` is reachable at startup, the limiter uses Redis keys `rl:<ip>:<minute>`, a fixed 60-second
  window. If Redis is unavailable, it falls back to an in-memory sliding window per process.
- The backend runs uvicorn with `--proxy-headers --forwarded-allow-ips *`, so the limit applies to the real client IP
  from nginx's `X-Forwarded-For`. If another proxy sits in front, make sure it sets that header, and restrict
  `--forwarded-allow-ips` to the proxy's address.
- Tune `FS_RATE_LIMIT_PER_MINUTE` for the expected dashboard polling load. Redis is used only for rate limiting in
  this build.

**Uploads**
- Uploads are stored under generated names in the `backend-storage` volume. Include that volume in backups, and
  consider malware scanning if the system is exposed to the public.

**Logging and audit**
- Security-relevant actions are stored in `audit_logs` (`GET /api/audit-logs`, ADMIN). Ship container logs to your
  log platform.

## Scaling notes

- **Run exactly one backend worker or replica.** The demo event clock, the per-city engine snapshot cache, runtime
  alert thresholds, manual road closures and the notification outbox are held **in process memory**. Several
  workers would each run their own clock and caches and disagree with one another. Scaling out would require moving
  that state into Redis/PostgreSQL and electing a single clock leader, which is not implemented.
- **CPU.** Building a city engine takes about 2 s. The first snapshot, including ML training, takes about 5 s, and
  each later 5-minute snapshot about 0.5 s. A What-If run takes about 0.5–1 s. Snapshots (40) and forecasts (48) are
  LRU-cached per city. Memory grows with the number of active cities, each holding a 360-minute baseline plus caches.
- **Model files.** The nowcast growth model is trained on first use and cached at
  `storage/models/nowcast_growth_v2.pkl` (kept in the `backend-storage` volume).
- **Static frontend.** The nginx container is stateless and can be replicated or moved to a CDN.
- **Database.** Writes are light: per-step predictions, alerts and drainage events, plus user activity. A single
  PostgreSQL instance is sufficient; add indexes and retention policies for `ai_predictions`, `flood_predictions`,
  `drainage_events` and `audit_logs` in long-running deployments.
