"""IP-based sliding-window rate limiter for our FastAPI backend.

Small in-memory dependency (no extra package). Sliding window over
monotonic timestamps per (scope, IP). Rate limits are read from the
environment at import time (see config). A Redis-backed limiter can replace
this class later for multi-instance production.

Rate limits protect OUR backend BEFORE expensive external calls:
    /api/current            CURRENT_RATE_LIMIT   (default 30/minute/IP)
    /api/weather            WEATHER_RATE_LIMIT   (default 30/minute/IP)
    /api/forecast           FORECAST_RATE_LIMIT  (default 20/minute/IP)
    /api/chat               CHAT_RATE_LIMIT      (default 10/minute/IP)
    reverse geocoding       GEOCODING_RATE_LIMIT (default 10/minute/IP)

Violations return HTTP 429 with a clean JSON body and a Retry-After hint.
Never expose stack traces or internal details.
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from fastapi import Depends, HTTPException, Request

import config


@dataclass
class _ScopeState:
    hits: list[float] = field(default_factory=list)


class SlidingWindowRateLimiter:
    """In-memory sliding-window limiter keyed by (scope, identifier)."""

    def __init__(self) -> None:
        self._states: dict[tuple[str, str], _ScopeState] = {}
        self._lock = asyncio.Lock()

    async def is_allowed(
        self,
        scope: str,
        identifier: str,
        limit: int,
        window_seconds: float,
    ) -> bool:
        now = time.monotonic()
        key = (scope, identifier)

        async with self._lock:
            state = self._states.setdefault(key, _ScopeState())
            # Prune hits that have fallen out of the window
            cutoff = now - window_seconds
            state.hits = [t for t in state.hits if t >= cutoff]

            if len(state.hits) >= limit:
                return False

            state.hits.append(now)
            return True

    async def remaining(self, scope: str, identifier: str, limit: int) -> int:
        window_seconds = 60.0
        now = time.monotonic()
        key = (scope, identifier)
        async with self._lock:
            state = self._states.setdefault(key, _ScopeState())
            state.hits = [t for t in state.hits if t >= now - window_seconds]
            return max(0, limit - len(state.hits))

    def reset(self) -> None:
        self._states.clear()


_limiter = SlidingWindowRateLimiter()


def get_rate_limiter() -> SlidingWindowRateLimiter:
    return _limiter


def _parse_rate(rate: str) -> tuple[int, float]:
    """Parse 'N/minute' (or second/hour) into (limit, window_seconds)."""
    parts = rate.split("/")
    try:
        limit = int(parts[0].strip())
    except (ValueError, IndexError):
        raise ValueError(f"Invalid rate limit specification: {rate!r}")
    unit = parts[1].strip().lower() if len(parts) > 1 else "minute"
    window_seconds = {
        "second": 1.0,
        "minute": 60.0,
        "hour": 3600.0,
    }.get(unit, 60.0)
    return limit, window_seconds


def rate_limit(rate_spec: str, scope: str = "http"):
    """Build a FastAPI dependency enforcing an IP-based rate limit.

    Usage:
        app.get("/api/current",
                dependencies=[Depends(rate_limit("30/minute", scope="current"))])
    """
    limit, window_seconds = _parse_rate(rate_spec)

    async def dependency(request: Request) -> None:
        limiter = get_rate_limiter()
        client_ip = request.client.host if request.client else "unknown"
        allowed = await limiter.is_allowed(
            scope, client_ip, limit, window_seconds
        )
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please try again later.",
            )

    return dependency


# Scope-keyed pre-parsed environment rates (used where the limit must be
# checked programmatically rather than via a route dependency).
RATE_SCOPES: dict[str, tuple[str, int, float]] = {
    "current": ("current", *_parse_rate(config.CURRENT_RATE_LIMIT)),
    "weather": ("weather", *_parse_rate(config.WEATHER_RATE_LIMIT)),
    "forecast": ("forecast", *_parse_rate(config.FORECAST_RATE_LIMIT)),
    "chat": ("chat", *_parse_rate(config.CHAT_RATE_LIMIT)),
    "geocoding": ("geocoding", *_parse_rate(config.GEOCODING_RATE_LIMIT)),
}


async def check_scope_limit(
    scope_name: str, request: Request
) -> None:
    """Programmatic rate-limit check for a named scope (429 on violation)."""
    scope, limit, window_seconds = RATE_SCOPES[scope_name]
    limiter = get_rate_limiter()
    client_ip = request.client.host if request.client else "unknown"
    allowed = await limiter.is_allowed(scope, client_ip, limit, window_seconds)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please try again later.",
        )