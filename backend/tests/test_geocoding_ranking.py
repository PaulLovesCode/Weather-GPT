"""Tests for location search ranking and the coordinates-beat-city contract.

The bug these guard against: a query for an ambiguous name ("Columbia",
"Springfield") used to resolve to whichever candidate came first after an
alphabetical sort biased towards India, so the weather shown could belong to a
place the user never chose.
"""

import asyncio
import pytest
import httpx
from unittest.mock import patch

import cache
import config
import geocoding
import main


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _provider_result(name, lat, lon, country=None, admin1=None, **extra):
    payload = {"name": name, "latitude": lat, "longitude": lon}
    if country is not None:
        payload["country"] = country
    if admin1 is not None:
        payload["admin1"] = admin1
    payload.update(extra)
    return payload


def _fake_client(results):
    """Patch http_client.get so search_locations returns `results` verbatim."""
    async def fake_get(url, **kwargs):
        return httpx.Response(
            200,
            json={"results": results},
            request=httpx.Request("GET", url),
        )

    return patch.object(geocoding.http_client, "get", fake_get)


@pytest.fixture(autouse=True)
def _clear_city_cache():
    cache.get_city_search_cache()._store.clear()
    yield
    cache.get_city_search_cache()._store.clear()


# ---------------------------------------------------------------------------
# Provider relevance order must survive
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_provider_order_is_preserved():
    """The dropdown renders this list, so it must arrive in provider order."""
    ordered = [
        _provider_result("Columbia", 38.95, -92.33, "United States", "Missouri"),
        _provider_result("Columbia", 49.11, -117.29, "Canada", "British Columbia"),
        _provider_result("Columbia", 22.89, 88.09, "India", "West Bengal"),
    ]

    with _fake_client(ordered):
        results = await geocoding.search_locations("Columbia")

    assert [r["admin1"] for r in results] == [
        "Missouri",
        "British Columbia",
        "West Bengal",
    ]


@pytest.mark.asyncio
async def test_no_alphabetical_override():
    """An alphabetical sort would hoist "East Springfield" above "Springfield".

    This is the exact regression that made searches resolve to the wrong city.
    """
    ordered = [
        _provider_result("Springfield", 39.78, -89.65, "United States", "Illinois"),
        _provider_result("East Springfield", 39.80, -89.55, "United States", "Illinois"),
    ]

    with _fake_client(ordered):
        results = await geocoding.search_locations("Springfield")

    assert [r["name"] for r in results] == ["Springfield", "East Springfield"]


@pytest.mark.asyncio
async def test_candidate_fields_are_carried_through():
    """population/feature_code drive disambiguation in the search UI."""
    with _fake_client([
        _provider_result(
            "Springfield", 39.78, -89.65, "United States", "Illinois",
            population=114394, feature_code="PPL", timezone="America/Chicago",
        )
    ]):
        results = await geocoding.search_locations("Springfield")

    assert results[0]["population"] == 114394
    assert results[0]["feature_code"] == "PPL"
    assert results[0]["timezone"] == "America/Chicago"


# ---------------------------------------------------------------------------
# Single-answer fallback picker
# ---------------------------------------------------------------------------

def test_exact_name_match_beats_india_preference():
    """An exact hit outranks an Indian near-miss."""
    locations = [
        _provider_result("Columbiabar", 22.89, 88.09, "India", "West Bengal"),
        _provider_result("Columbia", 38.95, -92.33, "United States", "Missouri"),
    ]
    picked = geocoding._select_best_candidate("Columbia", locations)
    assert picked["country"] == "United States"


def test_india_breaks_ties_between_exact_matches():
    """Both candidates are named "Columbia", so the India preference decides."""
    locations = [
        _provider_result("Columbia", 38.95, -92.33, "United States", "Missouri"),
        _provider_result("Columbia", 22.89, 88.09, "India", "West Bengal"),
    ]
    picked = geocoding._select_best_candidate("Columbia", locations)
    assert picked["country"] == "India"


def test_provider_order_breaks_remaining_ties():
    locations = [
        _provider_result("Springfield", 39.78, -89.65, "United States", "Illinois"),
        _provider_result("Springfield", 37.21, -93.29, "United States", "Missouri"),
    ]
    picked = geocoding._select_best_candidate("Springfield", locations)
    assert picked["admin1"] == "Illinois"


def test_india_remains_a_tiebreak():
    locations = [
        _provider_result("Colville", 48.55, -117.9, "United States", "Washington"),
        _provider_result("Col", 22.89, 88.09, "India", "West Bengal"),
    ]
    picked = geocoding._select_best_candidate("Col", locations)
    assert picked["country"] == "India"


def test_exact_match_is_case_and_accent_insensitive():
    locations = [
        _provider_result("Zurich", 47.37, 8.54, "Switzerland", "Zurich"),
        _provider_result("Sao Paulo", -23.55, -46.63, "Brazil", "Sao Paulo"),
    ]
    assert geocoding._select_best_candidate("são paulo", locations)["country"] == "Brazil"
    assert geocoding._select_best_candidate("ZURICH", locations)["country"] == "Switzerland"


def test_falls_back_to_provider_order():
    locations = [
        _provider_result("Colville", 48.55, -117.9, "United States", "Washington"),
        _provider_result("Columbus", 39.96, -82.99, "United States", "Ohio"),
    ]
    picked = geocoding._select_best_candidate("Nowhere At All", locations)
    assert picked["admin1"] == "Washington"


def test_no_candidates_returns_none():
    assert geocoding._select_best_candidate("Nowhere", []) is None


# ---------------------------------------------------------------------------
# The cache stores the candidate LIST, never a single verdict
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cache_stores_full_candidate_list():
    results = [
        _provider_result("Columbia", 38.95, -92.33, "United States", "Missouri"),
        _provider_result("Columbia", 49.11, -117.29, "Canada", "British Columbia"),
    ]

    with _fake_client(results):
        cached = await geocoding.cached_search_locations("Columbia")

    stored = cache.get_city_search_cache()._store["search:columbia"].value
    assert len(stored) == 2, "cache must hold every candidate, not one pick"
    assert [c["admin1"] for c in cached] == ["Missouri", "British Columbia"]


@pytest.mark.asyncio
async def test_dropdown_then_enter_makes_one_upstream_call():
    """The dropdown search and the subsequent lookup share one cache entry.

    This is the duplicate-request problem: the frontend calls /api/locations
    and then /api/weather + /api/forecast for the same query.
    """
    calls = 0

    async def fake_get(url, **kwargs):
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={"results": [
                _provider_result("London", 51.5, -0.12, "United Kingdom", "England"),
            ]},
            request=httpx.Request("GET", url),
        )

    with patch.object(geocoding.http_client, "get", fake_get):
        # 1. user types -> dropdown populates
        await geocoding.cached_search_locations("London")
        # 2. user hits Enter -> get_coordinates
        await geocoding.get_coordinates("London")
        # 3. /api/forecast resolves the same query
        await geocoding.get_coordinates("London")

    assert calls == 1, f"expected a single upstream geocoding call, got {calls}"


@pytest.mark.asyncio
async def test_concurrent_lookups_are_deduplicated():
    """Mirrors the parallel /api/weather + /api/forecast pair."""
    calls = 0

    async def slow_get(url, **kwargs):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return httpx.Response(
            200,
            json={"results": [
                _provider_result("Paris", 48.85, 2.35, "France", "Ile-de-France"),
            ]},
            request=httpx.Request("GET", url),
        )

    with patch.object(geocoding.http_client, "get", slow_get):
        results = await asyncio.gather(
            geocoding.cached_search_locations("Paris"),
            geocoding.cached_search_locations("paris"),
            geocoding.cached_search_locations("Paris"),
        )

    assert calls == 1, f"expected single-flight dedup, got {calls} calls"
    assert all(r[0]["name"] == "Paris" for r in results)


@pytest.mark.asyncio
async def test_empty_query_short_circuits():
    async def should_not_run(city):
        raise AssertionError("provider must not be called for an empty query")

    with patch.object(geocoding, "search_locations", should_not_run):
        assert await geocoding.cached_search_locations("   ") == []


# ---------------------------------------------------------------------------
# Provider errors
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_http_status_error_returns_empty_instead_of_raising():
    """A non-retryable 4xx must not surface as a 500."""
    async def failing_get(url, **kwargs):
        raise httpx.HTTPStatusError(
            "400 Bad Request",
            request=httpx.Request("GET", url),
            response=httpx.Response(400, request=httpx.Request("GET", url)),
        )

    with patch.object(geocoding.http_client, "get", failing_get):
        assert await geocoding.search_locations("!!!") == []


# ---------------------------------------------------------------------------
# Coordinates take precedence over the city string
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resolve_location_prefers_coordinates():
    async def must_not_geocode(city):
        raise AssertionError("geocoder must not run when coordinates are supplied")

    with patch.object(main, "get_coordinates", must_not_geocode):
        location = await main._resolve_location(
            None, 38.9517, -92.3341, "Columbia", "United States", "Missouri"
        )

    assert location == {
        "name": "Columbia",
        "latitude": 38.9517,
        "longitude": -92.3341,
        "country": "United States",
        "admin1": "Missouri",
    }


@pytest.mark.asyncio
async def test_resolve_location_coordinates_beat_conflicting_city():
    """A city string alongside coords must not override the picked location."""
    async def must_not_geocode(city):
        raise AssertionError("geocoder must not run when coordinates are supplied")

    with patch.object(main, "get_coordinates", must_not_geocode):
        location = await main._resolve_location(
            "Columbia", 38.9517, -92.3341, "Columbia", "United States", "Missouri"
        )

    assert location["latitude"] == 38.9517
    assert location["admin1"] == "Missouri"


@pytest.mark.asyncio
async def test_resolve_location_falls_back_to_city():
    async def fake_get_coordinates(city):
        return {"name": "London", "latitude": 51.5, "longitude": -0.12}

    with patch.object(main, "get_coordinates", fake_get_coordinates):
        location = await main._resolve_location("London")

    assert location["name"] == "London"


@pytest.mark.asyncio
async def test_resolve_location_without_any_target_is_none():
    location = await main._resolve_location(None)
    assert location is None


@pytest.mark.asyncio
async def test_resolve_location_rejects_out_of_range_coordinates():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        await main._resolve_location(None, 999.0, 5.0, "Nowhere")

    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# End-to-end: /api/weather accepts coordinates with no city param
# ---------------------------------------------------------------------------

def test_weather_endpoint_accepts_coordinates_without_city(monkeypatch):
    """Regression guard: `city` used to be a required query param.

    The dropdown's click path sends lat/lon/name and no city, which would have
    been rejected with a 422 before reaching the handler body.
    """
    from fastapi.testclient import TestClient

    async def fake_get_weather(lat, lon):
        return _StubWeatherResult()

    async def must_not_geocode(city):
        raise AssertionError("geocoder must not run for a coordinate request")

    monkeypatch.setattr(main, "get_weather", fake_get_weather)
    monkeypatch.setattr(main, "get_coordinates", must_not_geocode)

    client = TestClient(main.app)
    response = client.get(
        "/api/weather",
        params={
            "lat": 38.9517,
            "lon": -92.3341,
            "name": "Columbia",
            "country": "United States",
            "admin1": "Missouri",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["location"]["name"] == "Columbia"
    assert body["location"]["latitude"] == 38.9517
    assert body["location"]["admin1"] == "Missouri"


def test_weather_endpoint_without_any_location_reports_not_found(monkeypatch):
    from fastapi.testclient import TestClient

    client = TestClient(main.app)
    response = client.get("/api/weather")

    assert response.status_code == 200
    assert response.json()["error"] == "Location not found"


class _StubWeatherResult:
    data = {
        "temperature": 21.0,
        "apparent_temperature": 20.0,
        "humidity": 55,
        "wind_speed": 8.0,
        "condition": "Clear",
        "is_day": True,
        "precipitation": 0.0,
        "pressure": 1013.0,
        "visibility": 10.0,
        "uv_index": 5.0,
        "cloud_cover": 10,
    }
    source = "fresh"
