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
import unicodedata
from typing import Any

import config
import httpx
import http_client
from cache import (
    ProviderUnavailable,
    coordinate_key,
    get_city_search_cache,
    get_geocoding_cache,
)

logger = logging.getLogger("weathergpt.geocoding")

OPEN_METEO_GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
BIGDATACLOUD_URL = (
    "https://api.bigdatacloud.net/data/reverse-geocode-client"
)

# How many candidates to request per query. The search dropdown renders all of
# them, so this is a UI width decision rather than a "best match" one.
SEARCH_RESULT_COUNT = 10


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
    """City -> candidate locations via Open-Meteo geocoding.

    Results are returned in the provider's own relevance order and MUST NOT be
    reordered here. This list is the source of truth the search UI renders, so
    any client-side sorting would reintroduce the bug where a query resolves to
    a location the user never chose. Use :func:`get_coordinates` if you need a
    single best-effort answer instead.
    """
    params = {
        "name": city,
        "count": SEARCH_RESULT_COUNT,
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
    except (http_client.RetryExhausted, httpx.HTTPError):
        # HTTPStatusError (a non-retryable 4xx) must not surface as a 500;
        # callers treat an empty list as "no match for this query".
        logger.warning("geocoder provider=open-meteo operation=search error=unavailable")
        return []

    if "results" not in data or not data["results"]:
        return []

    return [_map_candidate(result) for result in data["results"]]


def _map_candidate(result: dict[str, Any]) -> dict[str, Any]:
    """Project an Open-Meteo geocoding result onto our location shape.

    ``population`` and ``feature_code`` are carried through so the search UI can
    disambiguate same-named places ("Springfield, Illinois - 114k") instead of
    leaving the user to guess.
    """
    return {
        "name": result["name"],
        "latitude": result["latitude"],
        "longitude": result["longitude"],
        "country": result.get("country"),
        "admin1": result.get("admin1"),
        "population": result.get("population"),
        "feature_code": result.get("feature_code"),
        "timezone": result.get("timezone"),
    }


async def cached_search_locations(city: str) -> list[dict[str, Any]]:
    """City -> candidate locations, cached as a list keyed by the query.

    Caching the *list* rather than a single picked candidate means a lookup
    never locks the caller into one interpretation of an ambiguous name, and
    ``get_or_fetch``'s single-flight behaviour means the parallel
    ``/api/weather`` + ``/api/forecast`` pair only makes one upstream call.
    """
    query = city.strip().lower()
    if not query:
        return []

    cache = get_city_search_cache()

    async def _fetch() -> list[dict[str, Any]]:
        return await search_locations(city)

    return await cache.get_or_fetch(
        f"search:{query}",
        config.CITY_SEARCH_CACHE_TTL,
        _fetch,
    )


def _normalize_place_name(name: str) -> str:
    """Case- and accent-insensitive form used for exact-match comparison."""
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return stripped.casefold().strip()


def _select_best_candidate(
    city: str, locations: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Pick one candidate for the non-interactive paths (Enter key, chat).

    Lexicographic preference, most significant key first:
      1. exact name match, so "Columbia" never resolves to Columbiabar
      2. an Indian location, preserving the original product preference
      3. the provider's own relevance order (``min`` keeps the first of equals)

    Note the absence of any alphabetical step: it previously overrode relevance
    outright, which is how a query could resolve to the wrong place.
    """
    if not locations:
        return None

    wanted = _normalize_place_name(city)

    return min(
        locations,
        key=lambda location: (
            _normalize_place_name(location.get("name") or "") != wanted,
            location.get("country") != "India",
        ),
    )


async def get_coordinates(city: str) -> dict[str, Any] | None:
    """Resolve a city name to a single best-guess location.

    Prefer passing explicit coordinates when the caller already knows them (the
    search UI does) so no geocoding happens at all.
    """
    locations = await cached_search_locations(city)
    return _select_best_candidate(city, locations)


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