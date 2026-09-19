# FloodShield AI — developer shortcuts
PY      ?= $(CURDIR)/.venv/bin/python
PIP     ?= $(CURDIR)/.venv/bin/pip
BACKEND := $(CURDIR)/backend
FRONTEND:= $(CURDIR)/frontend

.PHONY: install seed dev-backend dev-frontend test docker-up docker-down

install:            ## create the Python venv, install backend + frontend dependencies
	test -d .venv || python3.11 -m venv .venv || python3 -m venv .venv
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements.txt
	cd frontend && npm install

seed:               ## create tables and seed demo users, contacts, GIS tables (idempotent)
	cd backend && $(PY) -m scripts.seed

dev-backend:        ## FastAPI on http://localhost:8000 (Swagger at /api/docs)
	cd backend && $(PY) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend:       ## Vite dev server on http://localhost:5173 (proxies /api -> :8000)
	cd frontend && npm run dev

test:               ## backend test suite
	cd backend && $(PY) -m pytest -q

docker-up:          ## build and start frontend, backend, db (PostGIS), redis
	docker compose up -d --build

docker-down:        ## stop the stack (add -v manually to also drop volumes)
	docker compose down
