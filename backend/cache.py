"""In-memory TTL cache with single-flight deduplication.

Only used for the local/development deployment. The ``MemoryCache`` class is
a drop-in seam; swap the module-level instances for a Redis-backed
implementation when moving to a multi-instance production deployment.

Single-flight behaviour: when two (or more) concurrent requests ask for the
same cache key while the first external fetch is still running, they all
await the same in-flight future and only one provider request is made.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

import config

logger = __import__("logging").getLogger("weathergpt.cache")


class ProviderUnavailable(Exception):
    """External provider could not be reached and no (stale) data exists."""


@dataclass
class CachedValue:
    value: Any
    stored_at: float


class MemoryCache:
    def __init__(self):
        self._store: dict[str, CachedValue] = {}
        self._inflight: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    async def get_fresh(self, key: str, ttl: float) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        age = time.monotonic() - entry.stored_at
        if age <= ttl:
            logger.info("cache hit operation=%s key=%s", "cache", key)
            return entry.value
        return None

    async def get_stale(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        age = time.monotonic() - entry.stored_at
        if age > config.STALE_CACHE_MAX_AGE:
            logger.info("cache stale-expired key=%s age=%.0fs", key, age)
            return None
        logger.warning(
            "Open-Meteo unavailable; returning stale cached data key=%s age=%.0fs",
            key,
            age,
        )
        return entry.value

    async def get_or_fetch(
        self,
        key: str,
        ttl: float,
        fetcher: Callable[[], Awaitable[Any]],
    ) -> Any:
        """Return a fresh cached value, dedup against in-flight requests, or
        fetch from the provider. Raises when the provider fails and no fresh
        data exists (callers may then consult ``get_stale``)."""
        fresh = await self.get_fresh(key, ttl)
        if fresh is not None:
            return fresh

        async with self._lock:
            existing = self._inflight.get(key)
            if existing is not None:
                # Another request is already fetching this key; reuse result.
                in_flight = existing
            else:
                in_flight = None
                future: asyncio.Future = asyncio.get_running_loop().create_future()
                self._inflight[key] = future

        if in_flight is not None:
            logger.info("cache single-flight key=%s", key)
            return await in_flight

        try:
            value = await fetcher()
        except BaseException as exc:
            future.set_exception(exc)
            try:
                await future
            except BaseException:
                pass
            raise
        else:
            future.set_result(value)
            self._store[key] = CachedValue(value=value, stored_at=time.monotonic())
            logger.info("cache set key=%s ttl=%.0fs", key, ttl)
            return value
        finally:
            async with self._lock:
                self._inflight.pop(key, None)


# ---------------------------------------------------------------------------
# Coordinate normalization + shared cache instances
# ---------------------------------------------------------------------------

_WEATHER_CACHE = MemoryCache()
_FORECAST_CACHE = MemoryCache()
_HOURLY_CACHE = MemoryCache()
_GEOCODING_CACHE = MemoryCache()


def coordinate_key(lat: float, lon: float) -> str:
    p = config.CACHE_ROUND_PRECISION
    return f"{round(lat, p)},{round(lon, p)}"


def get_weather_cache() -> MemoryCache:
    return _WEATHER_CACHE


def get_forecast_cache() -> MemoryCache:
    return _FORECAST_CACHE


def get_hourly_cache() -> MemoryCache:
    return _HOURLY_CACHE


def get_geocoding_cache() -> MemoryCache:
    return _GEOCODING_CACHE