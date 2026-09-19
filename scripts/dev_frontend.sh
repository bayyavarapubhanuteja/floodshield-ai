#!/usr/bin/env bash
# Start the FloodShield AI frontend (Vite dev server with /api proxy to :8000).
set -e
cd "$(dirname "$0")/../frontend"
[ -d node_modules ] || npm install
exec npx vite --port "${PORT:-5173}" --strictPort "$@"
