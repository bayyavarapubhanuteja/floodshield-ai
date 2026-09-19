# FloodShield AI — FastAPI backend
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Shared libraries used by OpenCV (headless) and NumPy/SciPy wheels
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

RUN useradd --create-home --uid 10001 floodshield \
    && mkdir -p /app/storage/uploads /app/storage/models \
    && chown -R floodshield:floodshield /app
USER floodshield

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/api/health' % __import__('os').environ.get('PORT','8000'), timeout=4).status == 200 else 1)"

# Single worker on purpose: the demo event clock, engine snapshot cache and alert thresholds
# are held in-process (see docs/DEPLOYMENT.md, "Scaling").
# PORT is injected by hosts such as Render; defaults to 8000 (docker-compose).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
