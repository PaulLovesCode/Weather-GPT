"""Geocoding: Open-Meteo city search + Nominatim/BigDataCloud reverse geocoding.

Nominatim fixes:
  - always sends an identifying User-Agent from ``NOMINATIM_USER_AGENT``
  - explicit timeouts
  - retries only transient failures (via http_client)
  - TTL-caches reverse-geocoding results (default 1 hour)
  - rate limited via GENCODING rate scope (enforced at the route level)
  - falls back to coordinate-based location on failure so the weather
    endpoint still works when Nominatim is unavailable
"""

import logging
from typing import Any

import config
import http_client
from cache import (
    ProviderUnavailable,
    coordinate_key,
    get_geocoding_cache,
)

logger = logging.getLogger("weathergpt.geocoding")

OPEN_METEO_GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
BIGDATACLOUD_URL = (
    "https://api.bigdatacloud.net/data/reverse-geocode-client"
)


def _headers() -> dict[str, str]:
    return {"User-Agent": config.NOMINATIM_USER_AGENT}


_ADMIN_SUFFIXES = (
    " municipal corporation",
    " corporation",
    " municipality",
    " municipal council",
    " city council",
    " town council",
    " nagar panchayat",
    " district",
    " metropolitan area",
)


def _clean_place_name(raw: str) -> str:
    """Strip trailing administrative suffixes (e.g. 'Chennai Corporation')."""
    name = raw.strip()
    # Chained names become the head ("Madhyamgram" from "Madhyamgram, Kolkata...")
    name = name.split(",")[0].strip()
    # Drop parenthetical annotations, e.g. "Bengaluru (Bengaluru Urban, ...)"
    paren = name.find("(")
    if paren > 0:
        name = name[:paren].strip()
    lowered = name.lower()
    for suffix in _ADMIN_SUFFIXES:
        if lowered.endswith(suffix):
            shortened = name[: -len(suffix)].strip()
            if shortened:
                name = shortened
                break
    return name


async def search_locations(city: str) -> list[dict[str, Any]]:
    """City -> candidate locations via Open-Meteo geocoding."""
    params = {
        "name": city,
        "count": 5,
        "language": "en",
        "format": "json",
    }
    try:
        response = await http_client.get(
            OPEN_METEO_GEO_URL,
            provider="open-meteo",
            operation="geocoding.search",
            params=params,
            headers=_headers(),
        )
        data = response.json()
    except http_client.RetryExhausted:
        logger.warning("geocoder provider=open-meteo operation=search error=unavailable")
        return []

    if "results" not in data or not data["results"]:
        return []

    locations = []
    for location in data["results"]:
        locations.append({
            "name": location["name"],
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "country": location.get("country"),
            "admin1": location.get("admin1"),
        })

    # Prefer Indian locations if ambiguity exists
    locations.sort(
        key=lambda location: (
            location.get("country") != "India",
            location.get("name", ""),
        )
    )

    return locations


async def get_coordinates(city: str) -> dict[str, Any] | None:
    locations = await search_locations(city)
    if not locations:
        return None
    return locations[0]


def _coordinate_fallback(
    latitude: float, longitude: float
) -> dict[str, Any]:
    """Location payload using coordinates when no usable place name exists."""
    return {
        "name": "Nearest Location",
        "latitude": latitude,
        "longitude": longitude,
    }


async def reverse_geocode(
    latitude: float, longitude: float
) -> dict[str, Any]:
    """Reverse geocode to a place name, cached. Never raises; falls back to
    the original coordinates with a generic label on failure."""
    key = coordinate_key(latitude, longitude)
    cache = get_geocoding_cache()

    fresh = await cache.get_fresh(key, config.GEOCODING_CACHE_TTL)
    if fresh is not None:
        logger.info("cache hit operation=reverse_geocode key=%s", key)
        return fresh

    async def _fetch() -> dict[str, Any]:
        # 1. Nominatim (fine-grained town/suburb/county names)
        place = await _nominatim_reverse(latitude, longitude)
        if place is not None:
            return place

        # 2. BigDataCloud fallback
        place = await _bigdatacloud_reverse(latitude, longitude)
        if place is not None:
            return place

        # 3. Coordinates-only fallback
        logger.warning(
            "geocoder provider=nominatim,bdc error=unavailable; using coordinate fallback"
        )
        return _coordinate_fallback(latitude, longitude)

    try:
        return await cache.get_or_fetch(key, config.GEOCODING_CACHE_TTL, _fetch)
    except ProviderUnavailable:
        logger.warning(
            "geocoder provider=nominatim,bdc error=unavailable; using coordinate fallback"
        )
        return _coordinate_fallback(latitude, longitude)


async def _nominatim_reverse(
    latitude: float, longitude: float
) -> dict[str, Any] | None:
    try:
        response = await http_client.get(
            NOMINATIM_URL,
            provider="nominatim",
            operation="reverse",
            params={
                "lat": latitude,
                "lon": longitude,
                "format": "json",
            },
            headers=_headers(),
        )
        data = response.json()
        addr = data.get("address", {})
        location_name = (
            addr.get("city")
            or addr.get("town")
            or addr.get("suburb")
            or addr.get("village")
            or addr.get("municipality")
            or addr.get("county")
            or addr.get("state_district")
        )
        country = addr.get("country", "")

        if location_name:
            clean_name = _clean_place_name(location_name)
            if not clean_name:
                clean_name = _clean_place_name(country)
            return {
                "name": clean_name or location_name.split("-")[0].strip(),
                "country": country,
                "latitude": latitude,
                "longitude": longitude,
            }
    except http_client.RetryExhausted:
        logger.warning("geocoder provider=nominatim error=timeout")
    except Exception as exc:
        logger.warning("geocoder provider=nominatim error=%s", type(exc).__name__)
    return None


async def _bigdatacloud_reverse(
    latitude: float, longitude: float
) -> dict[str, Any] | None:
    try:
        response = await http_client.get(
            BIGDATACLOUD_URL,
            provider="bigdatacloud",
            operation="reverse",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "localityLanguage": "en",
            },
            headers=_headers(),
        )
        data = response.json()
        city_name = (
            data.get("city")
            or data.get("locality")
            or data.get("principalSubdivision")
            or data.get("countryName")
        )
        country = data.get("countryName", "")
        if city_name:
            return {
                "name": city_name,
                "country": country,
                "latitude": latitude,
                "longitude": longitude,
            }
    except http_client.RetryExhausted:
        logger.warning("geocoder provider=bigdatacloud error=timeout")
    except Exception as exc:
        logger.warning("geocoder provider=bigdatacloud error=%s", type(exc).__name__)
    return None