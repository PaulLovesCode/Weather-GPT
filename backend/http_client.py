"""Shared httpx client with bounded retries, Retry-After handling, and
a per-provider circuit breaker that suppresses request storms on 429.

Circuit states:
  CLOSED  -- normal operation
  OPEN    -- provider blocked; consecutive 429s exceeded threshold
  HALF    -- one probe request allowed after cooldown

For HTTP 429 specifically:
  - Retry at most OPEN_METEO_429_MAX_RETRIES times (default 1).
  - Respect Retry-After header up to 120 s; fall back to backoff.
  - After OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD consecutive 429 failures,
    open the circuit for OPEN_METEO_429_COOLDOWN seconds.
  - While OPEN, raise ProviderUnavailable immediately (no upstream call).

For other transient errors (408/425/500/502/503/504, transport):
  - Retry up to HTTP_MAX_RETRIES times with exponential backoff + jitter.
"""

import asyncio
import logging
import random
import time
from typing import Any

import httpx

import config

logger = logging.getLogger("weathergpt.http")


# ---------------------------------------------------------------------------
# Circuit-breaker state (in-process singleton per provider)
# ---------------------------------------------------------------------------

class _CircuitState:
    """Asyncio-safe circuit breaker for one provider."""

    CLOSED = "closed"
    OPEN = "open"
    HALF = "half_open"

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._state = self.CLOSED
        self._failure_count = 0
        self._opened_at: float = 0.0

    @property
    def state(self) -> str:
        return self._state

    async def allow_request(self) -> bool:
        """Return True if a request should proceed."""
        async with self._lock:
            if self._state == self.CLOSED:
                return True
            if self._state == self.OPEN:
                elapsed = time.monotonic() - self._opened_at
                if elapsed >= config.OPEN_METEO_429_COOLDOWN:
                    self._state = self.HALF
                    logger.info(
                        "circuit provider=open-meteo state=half_open"
                        " after_cooldown=%.0fs",
                        elapsed,
                    )
                    return True
                return False
            # HALF_OPEN: allow exactly one probe
            return True

    async def record_success(self) -> None:
        async with self._lock:
            if self._state == self.HALF:
                logger.info("circuit provider=open-meteo state=closed (probe succeeded)")
            self._state = self.CLOSED
            self._failure_count = 0

    async def record_429(self) -> None:
        async with self._lock:
            self._failure_count += 1
            if (
                self._state == self.HALF
                or self._failure_count >= config.OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD
            ):
                self._state = self.OPEN
                self._opened_at = time.monotonic()
                logger.warning(
                    "circuit provider=open-meteo state=open failures=%s"
                    " cooldown=%.0fs",
                    self._failure_count,
                    config.OPEN_METEO_429_COOLDOWN,
                )


_circuits: dict[str, _CircuitState] = {}


def _get_circuit(provider: str) -> _CircuitState:
    if provider not in _circuits:
        _circuits[provider] = _CircuitState()
    return _circuits[provider]


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class RetryExhausted(Exception):
    """Raised when every retry attempt fails on a transient error."""

    def __init__(
        self,
        provider: str,
        operation: str,
        kind: str,
        attempts: int,
        last_status: int | None,
        detail: str,
    ):
        self.provider = provider
        self.operation = operation
        self.kind = kind
        self.attempts = attempts
        self.last_status = last_status
        self.detail = detail
        super().__init__(detail)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _backoff_delay(attempt_index: int) -> float:
    """Exponential backoff with +/-30% jitter. attempt_index is 0-based."""
    base = config.HTTP_BACKOFF_BASE[min(
        attempt_index, len(config.HTTP_BACKOFF_BASE) - 1
    )]
    jitter = random.uniform(0.8, 1.3)
    return base * jitter


def _parse_retry_after(value: str | None) -> float | None:
    """Parse Retry-After header into seconds, clamped to safe maximum."""
    if not value:
        return None
    try:
        seconds = float(value.strip())
    except ValueError:
        return None
    if seconds <= 0 or seconds > 120:
        return None
    return seconds


def _is_retryable_status(status: int) -> bool:
    return status in config.RETRYABLE_STATUS


def _is_transport_error(exc: BaseException) -> bool:
    return isinstance(
        exc,
        (
            httpx.ConnectTimeout,
            httpx.ReadTimeout,
            httpx.WriteTimeout,
            httpx.PoolTimeout,
            httpx.ConnectError,
        ),
    )


# ---------------------------------------------------------------------------
# Core request function
# ---------------------------------------------------------------------------

async def request(
    method: str,
    url: str,
    *,
    provider: str,
    operation: str,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
    client: httpx.AsyncClient | None = None,
) -> httpx.Response:
    """Perform an HTTP request with circuit breaker, bounded retries, and
    Retry-After awareness.

    Returns the httpx.Response on success.
    Raises RetryExhausted for persistent transient failures.
    Raises cache.ProviderUnavailable when the circuit is OPEN.
    """
    from cache import ProviderUnavailable  # avoid circular import at module level

    circuit = _get_circuit(provider)

    # --- Circuit-breaker gate ---
    if not await circuit.allow_request():
        logger.warning(
            "circuit provider=%s operation=%s state=open; skipping upstream call",
            provider,
            operation,
        )
        raise ProviderUnavailable(f"{provider}/{operation} circuit open")

    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=config.HTTP_TIMEOUT_CONNECT,
                read=config.HTTP_TIMEOUT_READ,
                write=config.HTTP_TIMEOUT_WRITE,
                pool=config.HTTP_TIMEOUT_POOL,
            ),
            follow_redirects=True,
        )

    worst_status: int | None = None
    attempts = 0

    # 429 uses a separate, stricter retry cap
    max_429_retries = (
        config.OPEN_METEO_429_MAX_RETRIES
        if provider == "open-meteo"
        else config.HTTP_MAX_RETRIES
    )
    retries_429_used = 0

    try:
        for attempt_index in range(config.HTTP_MAX_RETRIES + 1):
            attempts = attempt_index + 1
            start = time.monotonic()

            try:
                response = await client.request(
                    method,
                    url,
                    params=params,
                    headers=headers,
                    json=json_body,
                )
            except Exception as exc:  # transport-level failure
                if _is_transport_error(exc):
                    if attempts <= config.HTTP_MAX_RETRIES:
                        delay = _backoff_delay(attempt_index)
                        logger.warning(
                            "provider=%s operation=%s transport=%s attempt=%s "
                            "retry_in=%.2fs",
                            provider, operation, type(exc).__name__, attempts, delay,
                        )
                        await _sleep_async(delay)
                        continue
                    raise RetryExhausted(
                        provider=provider,
                        operation=operation,
                        kind="transport",
                        attempts=attempts,
                        last_status=None,
                        detail=f"{type(exc).__name__}: {exc}",
                    ) from exc
                raise  # non-retryable transport error

            elapsed = time.monotonic() - start
            status = response.status_code

            if status == 429:
                retry_after_raw = response.headers.get("Retry-After")
                retry_after = _parse_retry_after(retry_after_raw)
                delay = retry_after if retry_after is not None else _backoff_delay(attempt_index)

                logger.warning(
                    "provider=%s operation=%s status=429 attempt=%s "
                    "retry_after=%s delay=%.2fs retries_429_used=%s max=%s",
                    provider, operation, attempts,
                    retry_after_raw or "none", delay,
                    retries_429_used, max_429_retries,
                )

                await circuit.record_429()

                if retries_429_used >= max_429_retries:
                    logger.warning(
                        "provider=%s operation=%s status=429 fast-fail after %s "
                        "429-retries; circuit=%s",
                        provider, operation, retries_429_used + 1, circuit.state,
                    )
                    raise RetryExhausted(
                        provider=provider,
                        operation=operation,
                        kind="http",
                        attempts=attempts,
                        last_status=429,
                        detail=f"HTTP 429 after {attempts} attempts (circuit={circuit.state}).",
                    )

                retries_429_used += 1
                worst_status = 429
                await _sleep_async(delay)
                continue

            if not _is_retryable_status(status):
                logger.info(
                    "provider=%s operation=%s status=%s elapsed=%.2fs circuit=%s",
                    provider, operation, status, elapsed, circuit.state,
                )
                if status >= 400:
                    response.raise_for_status()
                await circuit.record_success()
                return response

            # Other retryable statuses (500/502/503/504/408/425)
            worst_status = max(worst_status or 0, status)
            if attempts > config.HTTP_MAX_RETRIES:
                break

            delay = _backoff_delay(attempt_index)
            logger.warning(
                "provider=%s operation=%s status=%s attempt=%s retry_in=%.2fs",
                provider, operation, status, attempts, delay,
            )
            await _sleep_async(delay)

        raise RetryExhausted(
            provider=provider,
            operation=operation,
            kind="http",
            attempts=attempts,
            last_status=worst_status,
            detail=f"HTTP {worst_status} after {attempts} attempts.",
        )
    finally:
        if owns_client:
            await client.aclose()


async def get(
    url: str,
    *,
    provider: str,
    operation: str,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    client: httpx.AsyncClient | None = None,
) -> httpx.Response:
    return await request(
        "GET",
        url,
        provider=provider,
        operation=operation,
        params=params,
        headers=headers,
        client=client,
    )


async def _sleep_async(seconds: float) -> None:
    await asyncio.sleep(seconds)


# ---------------------------------------------------------------------------
# Shared long-lived connection-pooled client
# ---------------------------------------------------------------------------

_shared_client: httpx.AsyncClient | None = None


def get_shared_client() -> httpx.AsyncClient:
    """Return a lazily-created, long-lived pooled client."""
    global _shared_client
    if _shared_client is None:
        _shared_client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=config.HTTP_TIMEOUT_CONNECT,
                read=config.HTTP_TIMEOUT_READ,
                write=config.HTTP_TIMEOUT_WRITE,
                pool=config.HTTP_TIMEOUT_POOL,
            ),
            follow_redirects=True,
        )
    return _shared_client


async def close_shared_client() -> None:
    global _shared_client
    if _shared_client is not None:
        await _shared_client.aclose()
        _shared_client = None