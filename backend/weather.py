"""Open-Meteo weather provider -- combined single-request fetch.

Instead of three separate Open-Meteo requests per coordinate set
(current, hourly, daily), this module issues ONE combined request
containing all required fields. The combined response is stored in a
single cache entry (_COMBINED_CACHE) and then sliced into the
individual payloads that the existing public functions return.

Public API is unchanged:
  get_weather(lat, lon)          -> WeatherResult  # current conditions
  get_forecast(lat, lon)         -> WeatherResult  # 7-day daily forecast
  get_hourly_forecast(lat, lon)  -> WeatherResult  # 24-hour hourly

Each returns a WeatherResult with source in ("fresh", "cache", "stale").

Stale-cache fix: _get_combined() returns (stale_data, "stale") when
stale cache exists, instead of raising ProviderUnavailable.  Only raises
when there is neither fresh nor stale cache AND the provider is down.
"""

import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

import config
import http_client
from cache import (
    CachedValue,
    MemoryCache,
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

# ---------------------------------------------------------------------------
# Combined-response cache (one upstream call per coordinate set)
# ---------------------------------------------------------------------------
# Keyed by coordinate_key(lat, lon); TTL = min(weather, hourly) = 5 min.
_COMBINED_CACHE = MemoryCache()
COMBINED_TTL = min(config.WEATHER_CACHE_TTL, config.HOURLY_CACHE_TTL)  # 300 s


@dataclass
class WeatherResult:
    data: Any
    source: str  # "fresh" | "cache" | "stale"


# ---------------------------------------------------------------------------
# Weather code -> description
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Combined upstream fetch (ONE Open-Meteo call for current+hourly+daily)
# ---------------------------------------------------------------------------

async def _fetch_combined(latitude: float, longitude: float) -> dict[str, Any]:
    """Single Open-Meteo request covering current, hourly and daily fields."""
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
        "hourly": (
            "temperature_2m,"
            "precipitation_probability,"
            "weather_code,"
            "wind_speed_10m"
        ),
        "daily": (
            "weather_code,"
            "temperature_2m_max,"
            "temperature_2m_min,"
            "precipitation_sum,"
            "precipitation_probability_max,"
            "wind_speed_10m_max"
        ),
        "timezone": "auto",
        "forecast_hours": 24,
        "forecast_days": 7,
    }
    start = time.monotonic()
    response = await http_client.get(
        OPEN_METEO_URL,
        provider="open-meteo",
        operation="combined",
        params=params,
        headers=WEATHER_HEADERS,
        client=http_client.get_shared_client(),
    )
    elapsed = time.monotonic() - start
    data = response.json()
    logger.info(
        "provider=open-meteo operation=combined status=200 elapsed=%.2fs",
        elapsed,
    )
    return data


async def _get_combined(latitude: float, longitude: float) -> tuple[dict, str]:
    """Return the combined Open-Meteo response dict and its source label.

    Flow: fresh cache -> single-flight upstream fetch -> stale cache.
    Raises ProviderUnavailable only when all three paths fail.
    """
    key = coordinate_key(latitude, longitude)

    fresh = await _COMBINED_CACHE.get_fresh(key, COMBINED_TTL)
    if fresh is not None:
        logger.info("cache hit operation=combined key=%s", key)
        return fresh, "cache"

    try:
        value = await _COMBINED_CACHE.get_or_fetch(
            key, COMBINED_TTL, lambda: _fetch_combined(latitude, longitude)
        )
        return value, "fresh"
    except (ProviderUnavailable, http_client.RetryExhausted, httpx.HTTPError) as exc:
        logger.warning(
            "provider=open-meteo operation=combined error=%s; checking stale key=%s",
            type(exc).__name__,
            key,
        )
        stale = await _COMBINED_CACHE.get_stale(key)
        if stale is not None:
            logger.warning(
                "cache stale hit operation=combined key=%s circuit=%s",
                key,
                http_client._get_circuit("open-meteo").state,
            )
            return stale, "stale"
        raise ProviderUnavailable("open-meteo combined unavailable") from exc


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------

def _extract_current(data: dict, latitude: float, longitude: float) -> dict:
    current = data.get("current", {})
    return {
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
        "condition": get_weather_description(current.get("weather_code", 0)),
    }


def _extract_hourly(data: dict) -> list[dict]:
    hourly_raw = data.get("hourly", {})
    times = hourly_raw.get("time", [])
    temps = hourly_raw.get("temperature_2m", [])
    probs = hourly_raw.get("precipitation_probability", [])
    codes = hourly_raw.get("weather_code", [])
    winds = hourly_raw.get("wind_speed_10m", [])

    hourly_list: list[dict] = []
    for i in range(min(len(times), 24)):
        raw_time = times[i]
        try:
            formatted_time = datetime.fromisoformat(raw_time).strftime("%H:%M")
        except Exception:
            formatted_time = raw_time.split("T")[-1][:5] if "T" in raw_time else raw_time

        hourly_list.append({
            "time": formatted_time,
            "raw_time": raw_time,
            "temperature": temps[i] if i < len(temps) else 0.0,
            "rain_probability": probs[i] if i < len(probs) else 0,
            "condition": get_weather_description(codes[i] if i < len(codes) else 0),
            "wind_speed": winds[i] if i < len(winds) else 0.0,
        })
    return hourly_list


def _extract_forecast(data: dict) -> list[dict]:
    daily = data.get("daily", {})
    times = daily.get("time", [])
    max_t = daily.get("temperature_2m_max", [])
    min_t = daily.get("temperature_2m_min", [])
    precip = daily.get("precipitation_sum", [])
    rain_prob = daily.get("precipitation_probability_max", [])
    wind = daily.get("wind_speed_10m_max", [])
    codes = daily.get("weather_code", [])

    forecast: list[dict] = []
    for i in range(len(times)):
        forecast.append({
            "date": times[i],
            "temperature_max": max_t[i] if i < len(max_t) else 0.0,
            "temperature_min": min_t[i] if i < len(min_t) else 0.0,
            "precipitation": precip[i] if i < len(precip) else 0.0,
            "rain_probability": rain_prob[i] if i < len(rain_prob) else 0,
            "wind_speed_max": wind[i] if i < len(wind) else 0.0,
            "condition": get_weather_description(codes[i] if i < len(codes) else 0),
        })
    return forecast


# ---------------------------------------------------------------------------
# Public API (unchanged signatures)
# ---------------------------------------------------------------------------

async def get_weather(latitude: float, longitude: float) -> WeatherResult:
    """Current weather, backed by the combined cache."""
    combined, source = await _get_combined(latitude, longitude)
    data = _extract_current(combined, latitude, longitude)
    logger.info("provider=open-meteo operation=current cache=%s", source)
    return WeatherResult(data=data, source=source)


async def get_hourly_forecast(latitude: float, longitude: float) -> WeatherResult:
    """24-hour hourly forecast, backed by the combined cache."""
    combined, source = await _get_combined(latitude, longitude)
    data = _extract_hourly(combined)
    logger.info("provider=open-meteo operation=hourly cache=%s", source)
    return WeatherResult(data=data, source=source)


async def get_forecast(latitude: float, longitude: float) -> WeatherResult:
    """7-day daily forecast, backed by the combined cache."""
    combined, source = await _get_combined(latitude, longitude)
    data = _extract_forecast(combined)
    logger.info("provider=open-meteo operation=forecast cache=%s", source)
    return WeatherResult(data=data, source=source)