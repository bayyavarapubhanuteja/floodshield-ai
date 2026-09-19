#!/usr/bin/env bash
# Start the FloodShield AI backend (dev). Uses SQLite unless FS_DATABASE_URL is set.
set -e
cd "$(dirname "$0")/../backend"
PY="../.venv/bin/python"; [ -x "$PY" ] || PY=python3
exec "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" "$@"
