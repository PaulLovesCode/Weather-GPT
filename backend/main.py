import asyncio
import ipaddress
import logging
import math
import os
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

import config
import http_client
from cache import ProviderUnavailable, get_ip_geo_cache
from geocoding import (
    cached_search_locations,
    get_coordinates,
    reverse_geocode,
)
from intent import understand_weather_question
from llm import generate_weather_response
from ratelimit import RATE_SCOPES, get_rate_limiter, rate_limit
from cache import ProviderUnavailable
from weather import (
    WeatherResult,
    get_forecast,
    get_hourly_forecast,
    get_weather,
)

config.setup_logging()

logger = logging.getLogger("weathergpt.api")

app = FastAPI(
    title="WeatherGPT API",
    description="AI-powered conversational weather intelligence platform",
    version="0.1.0",
)

def _parse_cors_origins() -> list[str]:
    """Read CORS_ORIGINS env var and return a clean list of origins.

    Each origin is stripped of surrounding whitespace and trailing slashes
    so that browser ``Origin`` headers (which never carry a trailing slash)
    always match even if the env var was pasted with one.

    Defaults cover local development + the Vercel production domain and its
    wildcard preview pattern. The preview wildcard
    (``https://*.vercel.app``) is accepted by FastAPI's CORSMiddleware when
    ``allow_origin_regex`` is used, but we include it here as a plain
    string for clarity; callers that need regex support should extend this.
    """
    raw = os.getenv(
        "CORS_ORIGINS",
        (
            "http://localhost:3000,"
            "http://127.0.0.1:3000,"
            "https://atmosphereai.vercel.app,"
            "https://weather2-git-main-atmosphereai.vercel.app"
        ),
    )
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


_CORS_ORIGINS = _parse_cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    http_client.get_shared_client()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await http_client.close_shared_client()


# ============================================================
# Error format helpers
# ============================================================

def _error_response(
    status: int, code: str, message: str, retryable: bool
) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "detail": message,
            "error": {
                "code": code,
                "message": message,
                "retryable": retryable,
            },
        },
    )


def _validate_coords(lat: float, lon: float) -> tuple[float, float]:
    """Reject NaN, infinity and out-of-range coordinates with HTTP 400."""
    bad = (
        not math.isfinite(lat)
        or not math.isfinite(lon)
        or lat < -90
        or lat > 90
        or lon < -180
        or lon > 180
    )
    if bad:
        raise HTTPException(
            status_code=400,
            detail="Latitude or longitude is invalid.",
        )
    return lat, lon


async def _resolve_location(
    city: str | None,
    lat: float | None = None,
    lon: float | None = None,
    name: str | None = None,
    country: str | None = None,
    admin1: str | None = None,
) -> dict[str, Any] | None:
    """Decide which location a weather/forecast request is about.

    Coordinates win outright. When the caller already knows the exact place it
    picked from the search dropdown, re-geocoding the label would risk resolving
    to a different city with the same name -- the bug this parameter set exists
    to prevent -- so the geocoder is skipped entirely and the caller-supplied
    name is echoed back as the display label.
    """
    if lat is not None and lon is not None:
        lat, lon = _validate_coords(lat, lon)
        return {
            "name": name or f"{lat:.4f}, {lon:.4f}",
            "latitude": lat,
            "longitude": lon,
            "country": country,
            "admin1": admin1,
        }

    if not city or not city.strip():
        return None

    return await get_coordinates(city)


# ============================================================
# ROOT / HEALTH
# ============================================================

@app.get("/")
def root():
    return {
        "message": "WeatherGPT API is running",
        "version": "0.1.0",
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
    }


# ============================================================
# CITY-BASED WEATHER
# ============================================================

@app.get("/api/weather", dependencies=[Depends(rate_limit(config.WEATHER_RATE_LIMIT, scope="weather"))])
async def weather(
    city: str | None = None,
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    name: str | None = Query(None),
    country: str | None = Query(None),
    admin1: str | None = Query(None),
):
    location = await _resolve_location(city, lat, lon, name, country, admin1)

    if location is None:
        return {
            "error": "Location not found",
        }

    try:
        weather_result = await get_weather(
            location["latitude"], location["longitude"]
        )
    except ProviderUnavailable:
        return _error_response(
            503, "WEATHER_SERVICE_UNAVAILABLE",
            "Weather service is temporarily unavailable. "
            "Please try again shortly.",
            True,
        )

    data, source = weather_result.data, weather_result.source

    return {
        "location": location,
        "weather": data,
        "cached": source in ("cache", "stale"),
        "degraded": source == "stale",
    }


# ============================================================
# COORDINATE-BASED WEATHER
# ============================================================

@app.get(
    "/api/weather/current",
    dependencies=[Depends(rate_limit(config.WEATHER_RATE_LIMIT, scope="weather"))],
)
async def current_weather(
    lat: float = Query(...),
    lon: float = Query(...),
    request: Request = None,
):
    lat, lon = _validate_coords(lat, lon)

    location = await _safe_reverse_geocode(lat, lon, request)

    try:
        weather_result = await get_weather(lat, lon)
    except ProviderUnavailable:
        return _error_response(
            503, "WEATHER_SERVICE_UNAVAILABLE",
            "Weather service is temporarily unavailable. "
            "Please try again shortly.",
            True,
        )

    return {
        "location": location,
        "weather": weather_result.data,
        "cached": weather_result.source in ("cache", "stale"),
        "degraded": weather_result.source == "stale",
    }


# ============================================================
# CITY LOCATION
# ============================================================

@app.get("/api/location", dependencies=[Depends(rate_limit("20/minute", scope="location"))])
async def location(city: str):
    result = await get_coordinates(city)

    if result is None:
        return {
            "error": "Location not found",
        }

    return result


@app.get("/api/locations", dependencies=[Depends(rate_limit(config.LOCATION_SEARCH_RATE_LIMIT, scope="location"))])
async def locations(city: str):
    results = await cached_search_locations(city)

    if not results:
        return {
            "error": "Location not found",
        }

    return {
        "results": results,
    }


# ============================================================
# COARSE IP LOCATION (background refinement only)
# ============================================================

def _client_ip(request: Request) -> str | None:
    """Best-effort caller address, preferring the proxy-supplied forward chain.

    Behind a proxy or platform router (Render, ngrok, a LAN reverse proxy)
    ``request.client.host`` is the *proxy's* address, which would resolve every
    visitor to the same city. The leftmost ``X-Forwarded-For`` entry is the
    original client.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return None


def _is_private_ip(ip: str) -> bool:
    """True for loopback, link-local, and RFC1918/RFC4193 private addresses.

    Checked locally so private and development traffic never leaves the
    process, and so the endpoint degrades to a clear no-op under `localhost`.
    """
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        # Not an IP literal (e.g. a unix socket path) - treat as unusable.
        return True

    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_unspecified
        or address.is_multicast
    )


def _map_ip_geo_result(data: dict[str, Any]) -> dict[str, Any] | None:
    """Validate the provider payload and project it onto our location shape.

    The provider answers failures as ``{"success": false, "message": ...}`` with
    the requested fields simply absent, so presence is checked rather than
    trusted.
    """
    if not isinstance(data, dict) or not data.get("success"):
        return None

    name = data.get("city")
    latitude = data.get("latitude")
    longitude = data.get("longitude")

    if not isinstance(name, str) or not name.strip():
        return None
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return None
    if not (math.isfinite(latitude) and math.isfinite(longitude)):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None

    return {
        "name": name.strip(),
        "latitude": float(latitude),
        "longitude": float(longitude),
        "country": data.get("country"),
        "admin1": data.get("region"),
    }


@app.get(
    "/api/location/by-ip",
    dependencies=[Depends(rate_limit(config.LOCATION_IP_RATE_LIMIT, scope="location"))],
)
async def location_by_ip(request: Request):
    """Coarse city for the caller, used only to refine a denied geolocation.

    Every failure mode returns HTTP 200 with an ``error`` key rather than a 4xx
    or 5xx: the client already has a timezone-derived city rendered, and treats
    every failure here identically by falling through to its fixed default.
    """
    if not config.IP_GEO_ENABLED:
        return {"error": "disabled"}

    ip = _client_ip(request)
    if not ip or _is_private_ip(ip):
        logger.info("ip_geo skipped reason=private_or_unresolvable")
        return {"error": "private_ip"}

    cache = get_ip_geo_cache()

    async def _fetch() -> dict[str, Any] | None:
        try:
            response = await http_client.get(
                config.IP_GEO_URL.format(ip=ip),
                provider="ip-geo",
                operation="ip_geo.lookup",
                headers={"User-Agent": config.NOMINATIM_USER_AGENT},
            )
            data = response.json()
        except (
            http_client.RetryExhausted,
            ProviderUnavailable,
            httpx.HTTPStatusError,
            httpx.HTTPError,
            ValueError,
        ):
            logger.warning("ip_geo provider=ip-geo error=unavailable")
            return None

        mapped = _map_ip_geo_result(data)
        if mapped is None:
            logger.info("ip_geo provider=ip-geo result=unusable")
        return mapped

    try:
        location = await cache.get_or_fetch(
            f"ip:{ip}",
            config.IP_GEO_CACHE_TTL,
            _fetch,
        )
    except Exception:
        # Never let a provider or network fault surface as a 5xx here.
        logger.warning("ip_geo lookup failed", exc_info=True)
        return {"error": "unavailable"}

    if not location:
        return {"error": "unavailable"}

    return location


# ============================================================
# CITY-BASED FORECAST
# ============================================================

@app.get("/api/forecast", dependencies=[Depends(rate_limit(config.FORECAST_RATE_LIMIT, scope="forecast"))])
async def forecast(
    city: str | None = None,
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    name: str | None = Query(None),
    country: str | None = Query(None),
    admin1: str | None = Query(None),
):
    location = await _resolve_location(city, lat, lon, name, country, admin1)

    if location is None:
        return {
            "error": "Location not found",
        }

    forecast_result, hourly_result = await asyncio.gather(
        get_forecast(location["latitude"], location["longitude"]),
        get_hourly_forecast(location["latitude"], location["longitude"]),
        return_exceptions=True,
    )

    forecast_data = _unwrap(forecast_result, "forecast", default=[])
    hourly_data = _unwrap(hourly_result, "hourly", default=[])

    return {
        "location": location,
        "forecast": forecast_data,
        "hourly": hourly_data,
    }


# ============================================================
# COORDINATE-BASED FORECAST
# ============================================================

@app.get(
    "/api/forecast/current",
    dependencies=[Depends(rate_limit(config.FORECAST_RATE_LIMIT, scope="forecast"))],
)
async def current_forecast(
    lat: float = Query(...),
    lon: float = Query(...),
    request: Request = None,
):
    lat, lon = _validate_coords(lat, lon)

    location = await _safe_reverse_geocode(lat, lon, request)

    forecast_result, hourly_result = await asyncio.gather(
        get_forecast(lat, lon),
        get_hourly_forecast(lat, lon),
        return_exceptions=True,
    )

    forecast_data = _unwrap(forecast_result, "forecast", default=[])
    hourly_data = _unwrap(hourly_result, "hourly", default=[])

    return {
        "location": location,
        "forecast": forecast_data,
        "hourly": hourly_data,
    }


def _unwrap(result: Any, label: str, default: Any) -> Any:
    """Unpack a WeatherResult or catch a ProviderUnavailable exception."""
    if isinstance(result, BaseException):
        logger.warning("%s unavailable", label)
        return default
    if isinstance(result, WeatherResult):
        return result.data
    return default


# ============================================================
# /api/current  (single combined coordinate request)
# ============================================================

@app.get(
    "/api/current",
    dependencies=[Depends(rate_limit(config.CURRENT_RATE_LIMIT, scope="current"))],
)
async def current(
    lat: float = Query(...),
    lon: float = Query(...),
    request: Request = None,
):
    lat, lon = _validate_coords(lat, lon)

    location = await _safe_reverse_geocode(lat, lon, request)

    weather_result, forecast_result, hourly_result = await asyncio.gather(
        get_weather(lat, lon),
        get_forecast(lat, lon),
        get_hourly_forecast(lat, lon),
        return_exceptions=True,
    )

    # Current weather is the required payload -> stale fallback already
    # applied inside get_weather; a genuine failure yields HTTP 503.
    if isinstance(weather_result, BaseException):
        logger.warning("current weather provider failed")
        return _error_response(
            503, "WEATHER_SERVICE_UNAVAILABLE",
            "Weather service is temporarily unavailable. "
            "Please try again shortly.",
            True,
        )

    weather_data = weather_result.data
    source = weather_result.source

    forecast_data = _unwrap(forecast_result, "forecast", default=[])
    hourly_data = _unwrap(hourly_result, "hourly", default=[])

    return {
        "location": location,
        "weather": weather_data,
        "forecast": forecast_data,
        "hourly": hourly_data,
        "cached": source in ("cache", "stale"),
        "degraded": source == "stale",
        "source_status": {
            "weather": source,
            "forecast": result_source(forecast_result),
            "hourly": result_source(hourly_result),
            "location": "fresh",
        },
    }


def result_source(result: Any) -> str:
    if isinstance(result, BaseException):
        return "error"
    if isinstance(result, WeatherResult):
        return result.source
    return "unknown"


async def _safe_reverse_geocode(
    lat: float, lon: float, request: Request
) -> dict[str, Any]:
    """Reverse geocode with rate limiting; never raises.

    Respects the GEOCODING_RATE_LIMIT via its own IP scope. If the geocoder
    is rate limited or fails, a coordinate-based location is returned so the
    weather payload is never blocked by Nominatim.
    """
    from geocoding import _coordinate_fallback

    scope, limit, window_seconds = RATE_SCOPES["geocoding"]
    limiter = get_rate_limiter()
    client_ip = request.client.host if request.client else "unknown"
    allowed = await limiter.is_allowed(scope, client_ip, limit, window_seconds)
    if not allowed:
        logger.warning(
            "geocoder provider=nominatim rate_limited ip=%s; using coordinate fallback",
            client_ip,
        )
        return _coordinate_fallback(lat, lon)

    return await reverse_geocode(lat, lon)


# ============================================================
# DEDICATED HOURLY FORECAST
# ============================================================

@app.get(
    "/api/forecast/hourly",
    dependencies=[Depends(rate_limit(config.FORECAST_RATE_LIMIT, scope="forecast"))],
)
async def hourly_forecast(
    city: str | None = None,
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    name: str | None = Query(None),
    country: str | None = Query(None),
    admin1: str | None = Query(None),
):
    location = await _resolve_location(city, lat, lon, name, country, admin1)
    if location is None:
        return {"error": "Location not found"}

    hourly_result = await get_hourly_forecast(
        location["latitude"], location["longitude"]
    )
    hourly_data = (
        hourly_result.data
        if isinstance(hourly_result, WeatherResult)
        else []
    )
    return {
        "location": location,
        "hourly": hourly_data,
    }


@app.get(
    "/api/forecast/hourly/current",
    dependencies=[Depends(rate_limit(config.FORECAST_RATE_LIMIT, scope="forecast"))],
)
async def current_hourly_forecast(
    lat: float = Query(...),
    lon: float = Query(...),
    request: Request = None,
):
    lat, lon = _validate_coords(lat, lon)

    location = await _safe_reverse_geocode(lat, lon, request)

    hourly_result = await get_hourly_forecast(lat, lon)
    hourly_data = (
        hourly_result.data
        if isinstance(hourly_result, WeatherResult)
        else []
    )
    return {
        "location": location,
        "hourly": hourly_data,
    }


# ============================================================
# CHAT
# ============================================================

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    previous_location: str | None = None
    history: list[str] = Field(default_factory=list)

    @field_validator("message")
    @classmethod
    def _check_message_length(cls, value: str) -> str:
        if len(value) > config.MAX_CHAT_MESSAGE_LENGTH:
            raise ValueError(
                f"Message too long (max {config.MAX_CHAT_MESSAGE_LENGTH} "
                "characters)."
            )
        return value

    @field_validator("history")
    @classmethod
    def _check_history_size(cls, value: list[str]) -> list[str]:
        if len(value) > config.MAX_CHAT_HISTORY:
            raise ValueError(
                f"Conversation history too large (max {config.MAX_CHAT_HISTORY} "
                "messages)."
            )
        return value


class IntentRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=config.MAX_CHAT_MESSAGE_LENGTH)


@app.post(
    "/api/chat",
    dependencies=[Depends(rate_limit(config.CHAT_RATE_LIMIT, scope="chat"))],
)
async def chat(request: ChatRequest):
    message = request.message

    # Understand the user's question using the LLM (Gemini -> OpenRouter)
    intent = await understand_weather_question(message)

    # Use the location detected by the LLM
    city = intent.location

    # If no location was mentioned, use the previous location
    if not city:
        city = request.previous_location

    # Still no location available
    if not city:
        return {
            "reply": "Please tell me which city you want weather information for.",
        }

    # Convert city name to coordinates
    location = await get_coordinates(city)

    if location is None:
        return {
            "reply": f"I couldn't find the location '{city}'.",
        }

    # Get current weather
    weather_result = await get_weather(
        location["latitude"], location["longitude"]
    )
    weather_data = (
        weather_result.data
        if isinstance(weather_result, WeatherResult)
        else None
    )
    if weather_data is None:
        return {
            "reply": (
                "I'm sorry, the weather service is temporarily unavailable. "
                "Please try again shortly."
            ),
            "location": location,
        }

    # Get 7-day forecast
    forecast_result = await get_forecast(
        location["latitude"], location["longitude"]
    )
    forecast_data = (
        forecast_result.data
        if isinstance(forecast_result, WeatherResult)
        else []
    )

    # Generate natural-language response
    try:
        reply = await generate_weather_response(
            message,
            weather_data,
            forecast_data,
        )
    except Exception:
        logger.warning("LLM response generation failed; returning fallback")
        reply = (
            f"Right now in {location['name']} it's "
            f"{weather_data.get('temperature')}°C with "
            f"{weather_data.get('condition', '')}."
        )

    return {
        "reply": reply,
        "location": location,
    }


# ============================================================
# TEST INTENT
# ============================================================

@app.post(
    "/api/test-intent",
    dependencies=[Depends(rate_limit(config.CHAT_RATE_LIMIT, scope="chat"))],
)
async def test_intent(request: IntentRequest):
    intent = await understand_weather_question(request.message)
    return intent.model_dump()


# ============================================================
# Global error handlers
# ============================================================

@app.exception_handler(ProviderUnavailable)
async def _provider_unavailable_handler(request: Request, exc: ProviderUnavailable):
    return _error_response(
        503, "WEATHER_SERVICE_UNAVAILABLE",
        "Weather service is temporarily unavailable. Please try again shortly.",
        True,
    )


@app.exception_handler(HTTPException)
async def _http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == 429:
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": "60"},
            content={
                "detail": "Rate limit exceeded. Please try again later.",
                "error": {
                    "code": "RATE_LIMITED",
                    "message": "Too many requests. Please try again later.",
                    "retryable": True,
                },
            },
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": str(exc.detail),
            "error": {
                "code": "VALIDATION_ERROR" if exc.status_code in (400, 422) else "ERROR",
                "message": str(exc.detail),
                "retryable": False,
            },
        },
    )
