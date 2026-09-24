"""Open-Meteo weather provider access.

Every provider call is bounded by:
  - explicit timeouts (see config / http_client)
  - bounded retries with exponential backoff + jitter
  - TTL caching keyed on rounded coordinates
  - single-flight deduplication
  - stale-cache fallback when the provider is temporarily unavailable

The public functions keep the same names as before so existing endpoints
(city-based weather, forecast, chat, /api/current) continue to work. Each
returns a :class:`WeatherResult` carrying the payload plus a ``source``
marker ("fresh", "cache", "stale") that callers may surface as additive
fields (e.g. ``degraded``, ``cached``) without changing the payload shape.
"""

import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Awaitable

import httpx

import config
import http_client
from cache import (
    ProviderUnavailable,
    coordinate_key,
    get_forecast_cache,
    get_hourly_cache,
    get_weather_cache,
)

logger = logging.getLogger("weathergpt.weather")

WEATHER_HEADERS = {
    "User-Agent": config.NOMINATIM_USER_AGENT,
}

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


@dataclass
class WeatherResult:
    data: Any
    source: str  # "fresh" (just fetched) | "cache" (fresh cache hit) | "stale"


def get_weather_description(weather_code: int) -> str:
    weather_codes = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Slight snow",
        73: "Moderate snow",
        75: "Heavy snow",
        80: "Slight rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        95: "Thunderstorm",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail",
    }
    return weather_codes.get(weather_code, "Partly cloudy")


async def _fetch_json(
    params: dict[str, Any],
    operation: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Fetch and decode Open-Meteo JSON with bounded retries."""
    response = await http_client.get(
        OPEN_METEO_URL,
        provider="open-meteo",
        operation=operation,
        params=params,
        headers=WEATHER_HEADERS,
        client=client,
    )
    return response.json()


async def _resolve(
    key: str,
    ttl: float,
    cache,
    fetcher: Callable[[], Awaitable[Any]],
    label: str,
) -> WeatherResult:
    """Fresh cache -> provider fetch -> stale cache fallback."""
    fresh = await cache.get_fresh(key, ttl)
    if fresh is not None:
        logger.info("cache hit operation=%s key=%s", label, key)
        return WeatherResult(data=fresh, source="cache")

    try:
        value = await cache.get_or_fetch(key, ttl, fetcher)
        return WeatherResult(data=value, source="fresh")
    except (ProviderUnavailable, http_client.RetryExhausted, httpx.HTTPError):
        logger.warning(
            "Open-Meteo unavailable; returning stale cached %s data key=%s",
            label,
            key,
        )
        stale = await cache.get_stale(key)
        if stale is not None:
            return WeatherResult(data=stale, source="stale")
        raise ProviderUnavailable(f"{label} unavailable") from None


async def get_weather(latitude: float, longitude: float) -> WeatherResult:
    """Current weather, cached by rounded coordinates."""
    key = coordinate_key(latitude, longitude)
    ttl = config.WEATHER_CACHE_TTL
    cache = get_weather_cache()

    async def _fetch() -> dict[str, Any]:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "current": (
                "temperature_2m,"
                "relative_humidity_2m,"
                "apparent_temperature,"
                "precipitation,"
                "weather_code,"
                "wind_speed_10m,"
                "wind_direction_10m"
            ),
            "timezone": "auto",
        }
        start = time.monotonic()
        data = await _fetch_json(params, "current")
        elapsed = time.monotonic() - start
        current = data.get("current", {})
        result = {
            "location": {
                "latitude": data.get("latitude", latitude),
                "longitude": data.get("longitude", longitude),
            },
            "time": current.get("time"),
            "temperature": current.get("temperature_2m", 0.0),
            "feels_like": current.get("apparent_temperature", 0.0),
            "humidity": current.get("relative_humidity_2m", 0),
            "precipitation": current.get("precipitation", 0.0),
            "wind_speed": current.get("wind_speed_10m", 0.0),
            "wind_direction": current.get("wind_direction_10m", 0),
            "condition": get_weather_description(
                current.get("weather_code", 0)
            ),
        }
        logger.info(
            "weather provider=open-meteo operation=current status=200 elapsed=%.2fs",
            elapsed,
        )
        return result

    return await _resolve(key, ttl, cache, _fetch, "current_weather")


async def get_hourly_forecast(
    latitude: float, longitude: float
) -> WeatherResult:
    """24-hour hourly forecast telemetry, cached by rounded coordinates."""
    key = coordinate_key(latitude, longitude)
    ttl = config.HOURLY_CACHE_TTL
    cache = get_hourly_cache()

    async def _fetch() -> list[dict[str, Any]]:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": (
                "temperature_2m,"
                "precipitation_probability,"
                "weather_code,"
                "wind_speed_10m"
            ),
            "timezone": "auto",
            "forecast_hours": 24,
        }
        start = time.monotonic()
        data = await _fetch_json(params, "hourly")
        elapsed = time.monotonic() - start
        hourly_raw = data.get("hourly", {})
        times = hourly_raw.get("time", [])
        temps = hourly_raw.get("temperature_2m", [])
        probs = hourly_raw.get("precipitation_probability", [])
        codes = hourly_raw.get("weather_code", [])
        winds = hourly_raw.get("wind_speed_10m", [])

        hourly_list: list[dict[str, Any]] = []
        for i in range(min(len(times), 24)):
            raw_time = times[i]
            try:
                formatted_time = datetime.fromisoformat(raw_time).strftime("%H:%M")
            except Exception:
                formatted_time = (
                    raw_time.split("T")[-1][:5] if "T" in raw_time else raw_time
                )

            hourly_list.append({
                "time": formatted_time,
                "raw_time": raw_time,
                "temperature": temps[i] if i < len(temps) else 0.0,
                "rain_probability": probs[i] if i < len(probs) else 0,
                "condition": get_weather_description(
                    codes[i] if i < len(codes) else 0
                ),
                "wind_speed": winds[i] if i < len(winds) else 0.0,
            })

        logger.info(
            "weather provider=open-meteo operation=hourly status=200 elapsed=%.2fs",
            elapsed,
        )
        return hourly_list

    return await _resolve(key, ttl, cache, _fetch, "hourly_forecast")


async def get_forecast(latitude: float, longitude: float) -> WeatherResult:
    """7-day daily forecast, cached by rounded coordinates."""
    key = coordinate_key(latitude, longitude)
    ttl = config.FORECAST_CACHE_TTL
    cache = get_forecast_cache()

    async def _fetch() -> list[dict[str, Any]]:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "daily": (
                "weather_code,"
                "temperature_2m_max,"
                "temperature_2m_min,"
                "precipitation_sum,"
                "precipitation_probability_max,"
                "wind_speed_10m_max"
            ),
            "timezone": "auto",
            "forecast_days": 7,
        }
        start = time.monotonic()
        data = await _fetch_json(params, "forecast")
        elapsed = time.monotonic() - start
        daily = data.get("daily", {})

        forecast: list[dict[str, Any]] = []
        for i in range(len(daily.get("time", []))):
            forecast.append({
                "date": daily["time"][i],
                "temperature_max": daily["temperature_2m_max"][i],
                "temperature_min": daily["temperature_2m_min"][i],
                "precipitation": daily["precipitation_sum"][i],
                "rain_probability": daily["precipitation_probability_max"][i],
                "wind_speed_max": daily["wind_speed_10m_max"][i],
                "condition": get_weather_description(
                    daily["weather_code"][i]
                ),
            })

        logger.info(
            "weather provider=open-meteo operation=forecast status=200 elapsed=%.2fs",
            elapsed,
        )
        return forecast

    return await _resolve(key, ttl, cache, _fetch, "forecast")