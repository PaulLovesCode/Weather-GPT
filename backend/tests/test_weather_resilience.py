"""Tests for Open-Meteo resilience: 429 handling, circuit breaker, stale cache."""

import asyncio
import time
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Response builders
# ---------------------------------------------------------------------------

def _make_response(
    status: int,
    json_body: dict | None = None,
    retry_after: str | None = None,
) -> httpx.Response:
    headers = {}
    if retry_after is not None:
        headers["Retry-After"] = retry_after
    req = httpx.Request("GET", "https://api.open-meteo.com/v1/forecast")
    return httpx.Response(
        status_code=status,
        json=json_body or {},
        headers=headers,
        request=req,
    )


def _good_combined_response() -> httpx.Response:
    body = {
        "latitude": 51.5,
        "longitude": -0.12,
        "current": {
            "time": "2026-09-25T10:00",
            "temperature_2m": 18.0,
            "apparent_temperature": 16.5,
            "relative_humidity_2m": 70,
            "precipitation": 0.0,
            "wind_speed_10m": 12.0,
            "wind_direction_10m": 180,
            "weather_code": 2,
        },
        "hourly": {
            "time": ["2026-09-25T00:00"] * 24,
            "temperature_2m": [18.0] * 24,
            "precipitation_probability": [10] * 24,
            "weather_code": [2] * 24,
            "wind_speed_10m": [12.0] * 24,
        },
        "daily": {
            "time": ["2026-09-25"],
            "temperature_2m_max": [22.0],
            "temperature_2m_min": [14.0],
            "precipitation_sum": [0.0],
            "precipitation_probability_max": [10],
            "wind_speed_10m_max": [20.0],
            "weather_code": [2],
        },
    }
    return _make_response(200, body)


# ---------------------------------------------------------------------------
# Test: 200 OK parses correctly
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_open_meteo_200():
    import weather
    from cache import MemoryCache

    fresh_cache = MemoryCache()
    with patch.object(weather, "_COMBINED_CACHE", fresh_cache):
        with patch("http_client.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = _good_combined_response()
            result = await weather.get_weather(51.5, -0.12)

    assert result.source in ("fresh", "cache")
    assert result.data["temperature"] == 18.0
    assert "condition" in result.data


# ---------------------------------------------------------------------------
# Test: 429 retries exactly once then fast-fails
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_open_meteo_429_retries_once():
    import http_client
    import config
    from cache import ProviderUnavailable

    original_threshold = config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD
    original_max = config.OPEN_METEO_429_MAX_RETRIES
    config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD = 100  # keep circuit closed
    config.OPEN_METEO_429_MAX_RETRIES = 1

    # Reset circuit state
    http_client._circuits.pop("open-meteo", None)

    call_count = 0

    async def fake_request(method, url, **kwargs):
        nonlocal call_count
        call_count += 1
        return _make_response(429)

    client_mock = MagicMock(spec=httpx.AsyncClient)
    client_mock.request = AsyncMock(side_effect=fake_request)
    client_mock.aclose = AsyncMock()

    with patch("httpx.AsyncClient", return_value=client_mock):
        with pytest.raises(http_client.RetryExhausted) as exc_info:
            await http_client.get(
                "https://api.open-meteo.com/v1/forecast",
                provider="open-meteo",
                operation="test",
            )

    assert exc_info.value.last_status == 429
    assert call_count == 2  # 1 original + 1 retry

    config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD = original_threshold
    config.OPEN_METEO_429_MAX_RETRIES = original_max
    http_client._circuits.pop("open-meteo", None)


# ---------------------------------------------------------------------------
# Test: Retry-After header is respected
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_open_meteo_429_retry_after():
    import http_client
    import config

    original_threshold = config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD
    original_max = config.OPEN_METEO_429_MAX_RETRIES
    config.OPEN_METEO_429_MAX_RETRIES = 1
    config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD = 100

    http_client._circuits.pop("open-meteo", None)

    delays_slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays_slept.append(seconds)

    async def fake_request(method, url, **kwargs):
        return _make_response(429, retry_after="5")

    client_mock = MagicMock(spec=httpx.AsyncClient)
    client_mock.request = AsyncMock(side_effect=fake_request)
    client_mock.aclose = AsyncMock()

    with patch("http_client._sleep_async", fake_sleep):
        with patch("httpx.AsyncClient", return_value=client_mock):
            with pytest.raises(http_client.RetryExhausted):
                await http_client.get(
                    "https://api.open-meteo.com/v1/forecast",
                    provider="open-meteo",
                    operation="test",
                )

    assert delays_slept, "Expected at least one sleep call"
    assert delays_slept[0] == pytest.approx(5.0, abs=0.01)

    config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD = original_threshold
    config.OPEN_METEO_429_MAX_RETRIES = original_max
    http_client._circuits.pop("open-meteo", None)


# ---------------------------------------------------------------------------
# Test: Circuit opens after threshold
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_circuit_opens_after_threshold():
    import http_client
    import config

    config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD = 2

    circuit = http_client._CircuitState()
    await circuit.record_429()  # failure 1
    assert circuit.state == http_client._CircuitState.CLOSED
    await circuit.record_429()  # failure 2 -- threshold hit
    assert circuit.state == http_client._CircuitState.OPEN


# ---------------------------------------------------------------------------
# Test: Circuit cooldown and half-open
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_circuit_cooldown_half_open():
    import http_client
    import config

    config.OPEN_METEO_429_COOLDOWN = 0.01
    config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD = 1

    circuit = http_client._CircuitState()
    await circuit.record_429()
    assert circuit.state == http_client._CircuitState.OPEN
    assert not await circuit.allow_request()

    await asyncio.sleep(0.05)
    allowed = await circuit.allow_request()
    assert allowed
    assert circuit.state == http_client._CircuitState.HALF


# ---------------------------------------------------------------------------
# Test: Stale cache returned on provider failure (not 503)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stale_cache_returned_on_provider_failure():
    import weather
    from cache import CachedValue, MemoryCache, ProviderUnavailable

    stale_cache = MemoryCache()
    key = "51.5,0.0"
    stale_data = {
        "latitude": 51.5,
        "longitude": 0.0,
        "current": {
            "time": "2026-09-25T10:00",
            "temperature_2m": 15.0,
            "weather_code": 2,
            "apparent_temperature": 13.0,
            "relative_humidity_2m": 80,
            "precipitation": 0.0,
            "wind_speed_10m": 5.0,
            "wind_direction_10m": 90,
        },
        "hourly": {"time": [], "temperature_2m": [], "precipitation_probability": [],
                   "weather_code": [], "wind_speed_10m": []},
        "daily": {"time": [], "temperature_2m_max": [], "temperature_2m_min": [],
                  "precipitation_sum": [], "precipitation_probability_max": [],
                  "wind_speed_10m_max": [], "weather_code": []},
    }
    # Store with old timestamp so fresh TTL has passed
    stale_cache._store[key] = CachedValue(value=stale_data, stored_at=time.monotonic() - 600)

    with patch.object(weather, "_COMBINED_CACHE", stale_cache):
        with patch("http_client.get", side_effect=ProviderUnavailable("test")):
            result = await weather.get_weather(51.5, 0.0)

    assert result.source == "stale"
    assert result.data["temperature"] == 15.0


# ---------------------------------------------------------------------------
# Test: No cache + provider failure -> ProviderUnavailable raised
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_no_cache_provider_failure_raises():
    import weather
    from cache import MemoryCache, ProviderUnavailable

    empty_cache = MemoryCache()

    with patch.object(weather, "_COMBINED_CACHE", empty_cache):
        with patch("http_client.get", side_effect=ProviderUnavailable("test")):
            with pytest.raises(ProviderUnavailable):
                await weather.get_weather(51.5, 0.0)


# ---------------------------------------------------------------------------
# Test: Concurrent requests -> single upstream call (single-flight)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_single_flight_deduplication():
    import weather
    from cache import MemoryCache

    fresh_cache = MemoryCache()
    call_count = 0

    async def slow_get(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return _good_combined_response()

    with patch.object(weather, "_COMBINED_CACHE", fresh_cache):
        with patch("http_client.get", new_callable=AsyncMock, side_effect=slow_get):
            results = await asyncio.gather(
                weather.get_weather(51.5, -0.12),
                weather.get_weather(51.5, -0.12),
                weather.get_weather(51.5, -0.12),
            )

    assert call_count == 1, f"Expected 1 upstream call, got {call_count}"
    assert all(r.source in ("fresh", "cache") for r in results)


# ---------------------------------------------------------------------------
# Test: City geocoding cache
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_city_geocoding_cache():
    import cache
    import geocoding

    call_count = 0

    async def fake_search(city):
        nonlocal call_count
        call_count += 1
        return [{
            "name": "London",
            "latitude": 51.5,
            "longitude": -0.12,
            "country": "United Kingdom",
            "admin1": "England",
        }]

    cache.get_city_search_cache()._store.clear()

    with patch.object(geocoding, "search_locations", fake_search):
        r1 = await geocoding.get_coordinates("London")
        r2 = await geocoding.get_coordinates("London")
        r3 = await geocoding.get_coordinates("london")  # case-insensitive

    assert call_count == 1, f"Expected 1 geocoding call, got {call_count}"
    assert r1["name"] == "London"
    assert r2 == r1
    assert r3 == r1


# ---------------------------------------------------------------------------
# Test: /api/current response shape
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_api_current_response_shape():
    import weather
    from cache import MemoryCache

    fresh_cache = MemoryCache()
    with patch.object(weather, "_COMBINED_CACHE", fresh_cache):
        with patch("http_client.get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = _good_combined_response()
            wr = await weather.get_weather(51.5, -0.12)
            fr = await weather.get_forecast(51.5, -0.12)
            hr = await weather.get_hourly_forecast(51.5, -0.12)

    # weather shape
    assert "temperature" in wr.data
    assert "condition" in wr.data
    assert "humidity" in wr.data
    # forecast shape
    assert isinstance(fr.data, list)
    if fr.data:
        assert "date" in fr.data[0]
        assert "temperature_max" in fr.data[0]
    # hourly shape
    assert isinstance(hr.data, list)
    if hr.data:
        assert "time" in hr.data[0]
        assert "temperature" in hr.data[0]
