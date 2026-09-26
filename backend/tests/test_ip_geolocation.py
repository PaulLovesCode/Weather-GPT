"""Tests for the coarse IP location endpoint.

The contract that matters here is that this endpoint is *advisory*: the client
has already rendered a city from the browser's time zone, so every failure mode
must be a 200 with an ``error`` key and never a 4xx/5xx. A crash here would
otherwise surface as the hard error banner during ordinary startup.
"""

import httpx
import pytest
from unittest.mock import patch

import cache
import config
import main
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

IPWHO_SUCCESS = {
    "ip": "8.8.8.8",
    "success": True,
    "country": "United States",
    "country_code": "US",
    "region": "California",
    "city": "San Jose",
    "latitude": 37.3393939,
    "longitude": -121.8949553,
}

IPWHO_RESERVED = {
    "ip": "127.0.0.1",
    "success": False,
    "message": "Reserved range",
}


@pytest.fixture(autouse=True)
def _clear_ip_cache():
    cache.get_ip_geo_cache()._store.clear()
    yield
    cache.get_ip_geo_cache()._store.clear()


def _patch_provider(payload, status: int = 200):
    """Make the IP provider answer with `payload`, counting the calls made."""
    calls: list[str] = []

    async def fake_get(url, **kwargs):
        calls.append(url)
        return httpx.Response(
            status,
            json=payload,
            request=httpx.Request("GET", url),
        )

    return patch.object(main.http_client, "get", fake_get), calls


def _client():
    return TestClient(main.app)


# ---------------------------------------------------------------------------
# Private / unusable addresses must never leave the process
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "::1",
        "10.1.2.3",
        "192.168.1.20",
        "172.16.5.5",
        "169.254.1.1",
        "0.0.0.0",
        "not-an-ip",
    ],
)
def test_private_addresses_are_rejected_without_calling_provider(address):
    patcher, calls = _patch_provider(IPWHO_SUCCESS)
    with patcher:
        response = _client().get("/api/location/by-ip", headers={"X-Forwarded-For": address})

    assert response.status_code == 200
    assert response.json() == {"error": "private_ip"}
    assert calls == [], "private addresses must not be sent to the provider"


def test_loopback_client_is_rejected_even_without_forwarded_header():
    """Under `localhost` there is no forwarded header, and nothing to look up."""
    patcher, calls = _patch_provider(IPWHO_SUCCESS)
    with patcher:
        response = _client().get("/api/location/by-ip")

    assert response.status_code == 200
    assert response.json() == {"error": "private_ip"}
    assert calls == []


# ---------------------------------------------------------------------------
# Successful lookups
# ---------------------------------------------------------------------------

def test_public_address_maps_to_a_location():
    patcher, calls = _patch_provider(IPWHO_SUCCESS)
    with patcher:
        response = _client().get(
            "/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"}
        )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "San Jose"
    assert body["country"] == "United States"
    # The provider's `region` is projected onto our `admin1` field.
    assert body["admin1"] == "California"
    assert body["latitude"] == pytest.approx(37.3393939)
    assert body["longitude"] == pytest.approx(-121.8949553)
    assert len(calls) == 1
    assert "8.8.8.8" in calls[0]


def test_leftmost_forwarded_entry_wins():
    """Behind a proxy, the first hop is the real client; the rest are proxies."""
    patcher, calls = _patch_provider(IPWHO_SUCCESS)
    with patcher:
        response = _client().get(
            "/api/location/by-ip",
            headers={"X-Forwarded-For": "93.184.216.34, 10.0.0.1, 172.31.0.9"},
        )

    assert response.status_code == 200
    assert response.json()["name"] == "San Jose"
    assert "93.184.216.34" in calls[0]
    assert "10.0.0.1" not in calls[0]


def test_results_are_cached_per_address():
    patcher, calls = _patch_provider(IPWHO_SUCCESS)
    with patcher:
        client = _client()
        first = client.get("/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"})
        second = client.get("/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"})

    assert first.json() == second.json()
    assert len(calls) == 1, "the second request should be served from cache"


def test_cache_is_keyed_per_address():
    patcher, calls = _patch_provider(IPWHO_SUCCESS)
    with patcher:
        client = _client()
        client.get("/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"})
        client.get("/api/location/by-ip", headers={"X-Forwarded-For": "1.1.1.1"})

    assert len(calls) == 2


# ---------------------------------------------------------------------------
# Failure modes: all 200, all with `error`
# ---------------------------------------------------------------------------

def test_provider_reports_reserved_range():
    patcher, _ = _patch_provider(IPWHO_RESERVED)
    with patcher:
        response = _client().get(
            "/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"}
        )

    assert response.status_code == 200
    assert response.json() == {"error": "unavailable"}


@pytest.mark.parametrize(
    "payload",
    [
        {"success": True, "latitude": 1.0, "longitude": 2.0},  # no city
        {"success": True, "city": "Nowhere", "longitude": 2.0},  # no latitude
        {"success": True, "city": "Nowhere", "latitude": 1.0},  # no longitude
        {"success": True, "city": "Nowhere", "latitude": 999.0, "longitude": 2.0},
        {"success": True, "city": "Nowhere", "latitude": "n/a", "longitude": 2.0},
        {"success": True, "city": "   ", "latitude": 1.0, "longitude": 2.0},
        {"success": True, "city": "Nowhere", "latitude": None, "longitude": 2.0},
    ],
)
def test_unusable_payloads_degrade_to_unavailable(payload):
    patcher, _ = _patch_provider(payload)
    with patcher:
        response = _client().get(
            "/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"}
        )

    assert response.status_code == 200
    assert response.json() == {"error": "unavailable"}


def test_non_json_response_degrades_to_unavailable():
    async def fake_get(url, **kwargs):
        return httpx.Response(
            200,
            text="<html>not json</html>",
            request=httpx.Request("GET", url),
        )

    with patch.object(main.http_client, "get", fake_get):
        response = _client().get(
            "/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"}
        )

    assert response.status_code == 200
    assert response.json() == {"error": "unavailable"}


def test_provider_error_status_degrades_to_unavailable():
    async def fake_get(url, **kwargs):
        return httpx.Response(
            503,
            json={},
            request=httpx.Request("GET", url),
        )

    with patch.object(main.http_client, "get", fake_get):
        response = _client().get(
            "/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"}
        )

    assert response.status_code == 200
    assert response.json() == {"error": "unavailable"}


def test_network_failure_degrades_to_unavailable():
    async def fake_get(url, **kwargs):
        raise main.http_client.RetryExhausted(
            provider="ip-geo", operation="ip_geo.lookup", kind="transport",
            attempts=3, last_status=None, detail="boom",
        )

    with patch.object(main.http_client, "get", fake_get):
        response = _client().get(
            "/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"}
        )

    assert response.status_code == 200
    assert response.json() == {"error": "unavailable"}


def test_open_circuit_degrades_to_unavailable():
    """The shared circuit breaker raises its own error type for this provider."""
    from cache import ProviderUnavailable

    async def fake_get(url, **kwargs):
        raise ProviderUnavailable("ip-geo/ip_geo.lookup circuit open")

    with patch.object(main.http_client, "get", fake_get):
        response = _client().get(
            "/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"}
        )

    assert response.status_code == 200
    assert response.json() == {"error": "unavailable"}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def test_disabling_ip_geo_skips_the_provider_entirely(monkeypatch):
    monkeypatch.setattr(config, "IP_GEO_ENABLED", False)
    patcher, calls = _patch_provider(IPWHO_SUCCESS)
    with patcher:
        response = _client().get(
            "/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"}
        )

    assert response.status_code == 200
    assert response.json() == {"error": "disabled"}
    assert calls == []


def test_configured_url_is_used(monkeypatch):
    monkeypatch.setattr(config, "IP_GEO_URL", "https://example.test/geo/{ip}")
    patcher, calls = _patch_provider(IPWHO_SUCCESS)
    with patcher:
        _client().get("/api/location/by-ip", headers={"X-Forwarded-For": "8.8.8.8"})

    assert calls[0] == "https://example.test/geo/8.8.8.8"


def test_config_defaults_are_sane():
    assert config.IP_GEO_ENABLED is True
    assert config.IP_GEO_URL == "https://ipwho.is/{ip}"
    assert config.IP_GEO_CACHE_TTL == 3600


# ---------------------------------------------------------------------------
# Unit-level checks of the address classifier
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "address,is_private",
    [
        ("127.0.0.1", True),
        ("::1", True),
        ("10.0.0.1", True),
        ("172.16.0.1", True),
        ("172.31.255.255", True),
        ("192.168.0.1", True),
        ("169.254.10.1", True),
        ("172.32.0.1", False),
        ("8.8.8.8", False),
        ("93.184.216.34", False),
        # Documentation ranges are non-routable, so they are refused too.
        ("203.0.113.7", True),
        ("192.0.2.5", True),
        ("198.51.100.9", True),
        ("2606:4700::1111", False),
    ],
)
def test_private_classification(address, is_private):
    assert main._is_private_ip(address) is is_private


def test_forwarded_header_extraction():
    from starlette.requests import Request

    def request(headers):
        raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
        return Request({"type": "http", "headers": raw, "client": ("10.0.0.9", 1)})

    assert main._client_ip(request({"X-Forwarded-For": " 93.184.216.34 , 10.0.0.1 "})) == "93.184.216.34"
    assert main._client_ip(request({})) == "10.0.0.9"
