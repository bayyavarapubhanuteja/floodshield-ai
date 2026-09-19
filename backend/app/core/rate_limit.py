"""Simple sliding-window rate limiter (in-memory, Redis when configured)."""
import time
from collections import defaultdict, deque
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from .config import get_settings

settings = get_settings()
_buckets: dict[str, deque] = defaultdict(deque)
_redis = None
if settings.redis_url:
    try:
        import redis
        _redis = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1)
        _redis.ping()
    except Exception:
        _redis = None


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api") or request.url.path.startswith("/api/ws"):
            return await call_next(request)
        key = request.client.host if request.client else "anon"
        limit = settings.rate_limit_per_minute
        now = time.time()
        if _redis is not None:
            try:
                rk = f"rl:{key}:{int(now // 60)}"
                n = _redis.incr(rk)
                _redis.expire(rk, 70)
                if n > limit:
                    return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
                return await call_next(request)
            except Exception:
                pass
        q = _buckets[key]
        while q and q[0] < now - 60:
            q.popleft()
        if len(q) >= limit:
            return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
        q.append(now)
        return await call_next(request)
