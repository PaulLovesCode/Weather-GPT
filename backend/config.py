"""Centralised environment-based configuration for the WeatherGPT backend.

Every tunable value (timeouts, retries, rate limits, cache TTLs, model
lists, concurrency caps, chat limits) is read from environment variables so
the same codebase can run safely in development and production without
edits. All values carry sensible local-development defaults.
"""

import os
import logging

from dotenv import load_dotenv

load_dotenv()


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


# ---------------------------------------------------------------------------
# HTTP timeouts (applied to every external request)
# ---------------------------------------------------------------------------
HTTP_TIMEOUT_CONNECT: float = _env_float("HTTP_TIMEOUT_CONNECT", 15.0)
HTTP_TIMEOUT_READ: float = _env_float("HTTP_TIMEOUT_READ", 30.0)
HTTP_TIMEOUT_WRITE: float = _env_float("HTTP_TIMEOUT_WRITE", 15.0)
HTTP_TIMEOUT_POOL: float = _env_float("HTTP_TIMEOUT_POOL", 15.0)

# ---------------------------------------------------------------------------
# Retry behaviour (transient failures only)
# ---------------------------------------------------------------------------
HTTP_MAX_RETRIES: int = _env_int("HTTP_MAX_RETRIES", 3)
HTTP_BACKOFF_BASE: list[float] = _env_list(
    "HTTP_BACKOFF_BASE", ["1.0", "2.0", "4.0"]
)
try:
    HTTP_BACKOFF_BASE = [float(v) for v in HTTP_BACKOFF_BASE]
except ValueError:
    HTTP_BACKOFF_BASE = [1.0, 2.0, 4.0]

# HTTP statuses that are safe to retry. Everything else (400/401/403/404,
# malformed params, bad coordinates) is a permanent failure.
RETRYABLE_STATUS: set[int] = {408, 425, 429, 500, 502, 503, 504}

# ---------------------------------------------------------------------------
# Rate limits (requests per window per IP). Format: "N/unit" where unit is
# one of second, minute, hour.
# ---------------------------------------------------------------------------
DEFAULT_RATE_LIMIT: str = os.getenv("RATE_LIMIT", "30/minute")
CURRENT_RATE_LIMIT: str = os.getenv("CURRENT_RATE_LIMIT", DEFAULT_RATE_LIMIT)
WEATHER_RATE_LIMIT: str = os.getenv("WEATHER_RATE_LIMIT", DEFAULT_RATE_LIMIT)
FORECAST_RATE_LIMIT: str = os.getenv("FORECAST_RATE_LIMIT", "20/minute")
CHAT_RATE_LIMIT: str = os.getenv("CHAT_RATE_LIMIT", "10/minute")
GEOCODING_RATE_LIMIT: str = os.getenv("GEOCODING_RATE_LIMIT", "10/minute")

# ---------------------------------------------------------------------------
# Cache TTLs (seconds). Coordinate keys are rounded before hashing so tiny
# GPS jitter does not defeat the cache.
# ---------------------------------------------------------------------------
WEATHER_CACHE_TTL: int = _env_int("WEATHER_CACHE_TTL", 300)
FORECAST_CACHE_TTL: int = _env_int("FORECAST_CACHE_TTL", 900)
HOURLY_CACHE_TTL: int = _env_int("HOURLY_CACHE_TTL", 300)
GEOCODING_CACHE_TTL: int = _env_int("GEOCODING_CACHE_TTL", 3600)

CACHE_ROUND_PRECISION: int = _env_int("CACHE_ROUND_PRECISION", 4)

# Serve stale cached data for up to this many seconds if the provider is
# temporarily unavailable. Logs a warning and flags the response as degraded.
STALE_CACHE_MAX_AGE: int = _env_int("STALE_CACHE_MAX_AGE", 3600)

# ---------------------------------------------------------------------------
# External providers
# ---------------------------------------------------------------------------
NOMINATIM_USER_AGENT: str = os.getenv(
    "NOMINATIM_USER_AGENT",
    "WeatherGPT/1.0 (https://github.com/weathergpt-app/weather-capstone)",
)

# ---------------------------------------------------------------------------
# Gemini / LLM
# ---------------------------------------------------------------------------
GEMINI_MODELS: list[str] = _env_list(
    "GEMINI_MODELS",
    ["gemini-3.5-flash-lite"],
)
GEMINI_MAX_RETRIES: int = _env_int("GEMINI_MAX_RETRIES", 3)
GEMINI_TIMEOUT: float = _env_float("GEMINI_TIMEOUT", 45.0)
MAX_GEMINI_CONCURRENCY: int = _env_int("MAX_GEMINI_CONCURRENCY", 5)

# ---------------------------------------------------------------------------
# Chat request validation
# ---------------------------------------------------------------------------
MAX_CHAT_MESSAGE_LENGTH: int = _env_int("MAX_CHAT_MESSAGE_LENGTH", 4000)
MAX_CHAT_HISTORY: int = _env_int("MAX_CHAT_HISTORY", 20)


def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )