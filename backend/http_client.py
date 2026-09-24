"""Shared httpx client with bounded retries for transient failures.

All external requests (Open-Meteo, Nominatim, BigDataCloud) go through the
helpers in this module so that timeouts, retry policy, backoff, jitter,
Retry-After handling and logging are applied consistently everywhere.

Retry policy (exponential backoff + jitter):
    attempt 1 -> wait ~1s
    attempt 2 -> wait ~2s
    attempt 3 -> wait ~4s
    (each multiplied by a small random factor so concurrent clients do not
    hammer the provider in lockstep)

Only transient failures are retried:
    httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout,
    httpx.ConnectError, httpx.PoolTimeout,
    HTTP 408, 425, 429, 500, 502, 503, 504

Permanent errors (400/401/403/404/malformed) are never retried.
"""

import logging
import random
import time
from typing import Any

import httpx

import config

logger = logging.getLogger("weathergpt.http")


class RetryExhausted(Exception):
    """Raised when every retry attempt fails on a transient error.

    ``kind`` is one of "http" (worst HTTP status seen) or "transport"
    (worst transport exception). ``attempts`` is the total number of
    attempts made. ``last_status`` may be None for transport failures.
    """

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


def _backoff_delay(attempt_index: int) -> float:
    """Exponential backoff with jitter. attempt_index is 0-based."""
    base = config.HTTP_BACKOFF_BASE[min(
        attempt_index, len(config.HTTP_BACKOFF_BASE) - 1
    )]
    jitter = random.uniform(0.8, 1.3)
    return base * jitter


def _parse_retry_after(value: str | None) -> float | None:
    """Parse the Retry-After header into a number of seconds, if reasonable."""
    if not value:
        return None
    try:
        seconds = float(value.strip())
    except ValueError:
        return None
    # Refuse absurd wait times; fall back to our own backoff instead.
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
    """Perform an HTTP request with bounded retries.

    Returns the ``httpx.Response`` on success (any final non-retryable
    status). Raises :class:`RetryExhausted` when a transient failure
    persists past all retry attempts, or :class:`httpx.HTTPStatusError`
    for a final non-transient HTTP error status.
    """
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
    worst_transport: BaseException | None = None
    attempts = 0

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
                    worst_transport = exc
                    if attempts <= config.HTTP_MAX_RETRIES:
                        delay = _backoff_delay(attempt_index)
                        logger.warning(
                            "provider=%s operation=%s error=%s attempt=%s "
                            "retry_in=%.2fs",
                            provider,
                            operation,
                            type(exc).__name__,
                            attempts,
                            delay,
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
                # Non-retryable transport error (e.g. DNS decode errors)
                raise

            elapsed = time.monotonic() - start
            status = response.status_code

            if not _is_retryable_status(status):
                logger.info(
                    "provider=%s operation=%s status=%s elapsed=%.2fs",
                    provider,
                    operation,
                    status,
                    elapsed,
                )
                if status >= 400:
                    response.raise_for_status()  # final non-retryable error
                return response

            # Retryable HTTP status
            worst_status = max(worst_status or 0, status)
            if attempts > config.HTTP_MAX_RETRIES:
                break

            if status == 429:
                retry_after = _parse_retry_after(
                    response.headers.get("Retry-After")
                )
                delay = retry_after if retry_after is not None else _backoff_delay(
                    attempt_index
                )
                logger.warning(
                    "provider=%s operation=%s status=429 attempt=%s "
                    "retry_after=%s retrying",
                    provider,
                    operation,
                    attempts,
                    response.headers.get("Retry-After", "none"),
                )
            else:
                delay = _backoff_delay(attempt_index)
                logger.warning(
                    "provider=%s operation=%s status=%s attempt=%s "
                    "retry_in=%.2fs",
                    provider,
                    operation,
                    status,
                    attempts,
                    delay,
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
    import asyncio

    await asyncio.sleep(seconds)


_shared_client: httpx.AsyncClient | None = None


def get_shared_client() -> httpx.AsyncClient:
    """Return a lazily-created, long-lived pooled client.

    Reused across requests to avoid re-opening TLS connections each time.
    Shares the configured timeout. The application should call
    ``close_shared_client`` during shutdown.
    """
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