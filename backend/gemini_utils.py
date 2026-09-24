"""Gemini API access with model fallback, bounded retries and concurrency cap.

Model list is configurable via ``GEMINI_MODELS`` (comma-separated). Only
transient failures (429, 500, 502, 503, 504 and transport errors) are
retried with exponential backoff. Permanent errors (400/401/403, and 404 for
an unavailable model ID) are never retried — a 404 logs and moves on to the
next configured model.

A module-level :class:`asyncio.Semaphore` caps concurrent Gemini calls
(``MAX_GEMINI_CONCURRENCY``) so a burst of chat requests cannot open
hundreds of simultaneous Gemini requests.

Raw exception dumps are never surfaced to callers; a single controlled
:class:`GeminiUnavailable` error is raised when every model fails.
"""

import asyncio
import logging
import os
import time
from typing import Optional

from google import genai
from google.genai import types
from google.genai.errors import ClientError

import config

logger = logging.getLogger("weathergpt.gemini")

GEMINI_MODELS = config.GEMINI_MODELS
RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}

# Cap concurrent Gemini calls (one semaphore shared by the whole process).
_gemini_semaphore = asyncio.Semaphore(config.MAX_GEMINI_CONCURRENCY)


class GeminiUnavailable(Exception):
    """All configured Gemini models failed after bounded retries."""


def get_gemini_client() -> Optional[genai.Client]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    return genai.Client(api_key=api_key)


async def generate_gemini_response(
    prompt: str,
    system_instruction: str = "",
    json_mode: bool = False,
    temperature: float = 0.2,
    max_output_tokens: int = 1000,
) -> str:
    """Generate content using Gemini with bounded retries + model fallback.

    Each call runs inside ``MAX_GEMINI_CONCURRENCY`` semaphore to protect
    the Gemini quota. Raises :class:`GeminiUnavailable` when every model
    fails (never leaks raw provider exceptions).
    """
    client = get_gemini_client()
    if not client:
        raise GeminiUnavailable("GEMINI_API_KEY is not configured.")

    config_kwargs: dict = {
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
        "automatic_function_calling": types.AutomaticFunctionCallingConfig(
            disable=True
        ),
    }
    if json_mode:
        config_kwargs["response_mime_type"] = "application/json"
    if system_instruction:
        config_kwargs["system_instruction"] = system_instruction

    generated_config = types.GenerateContentConfig(**config_kwargs)

    async with _gemini_semaphore:
        last_error: BaseException | None = None

        for model_name in GEMINI_MODELS:
            for attempt_index in range(config.GEMINI_MAX_RETRIES):
                attempt = attempt_index + 1
                try:
                    response = await client.aio.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=generated_config,
                    )
                except ClientError as err:
                    code = getattr(err, "code", None)
                    status = getattr(err, "status", None)
                    http_code = code if isinstance(code, int) else (
                        getattr(status, "status_code", None)
                    )
                    http_code = int(http_code) if isinstance(http_code, (int, str)) and str(http_code).isdigit() else None

                    if http_code == 404:
                        # Permanently unavailable model -> skip, do not retry
                        logger.warning(
                            "Gemini model %s not found (404), skipping to next model",
                            model_name,
                        )
                        break
                    if http_code is not None and http_code not in RETRYABLE_STATUS:
                        # Permanent model/provider error -> skip model
                        logger.warning(
                            "Gemini model %s permanent error (status=%s), "
                            "trying next model",
                            model_name,
                            http_code,
                        )
                        break

                    last_error = err
                    if attempt >= config.GEMINI_MAX_RETRIES:
                        logger.warning(
                            "Gemini model %s failed after %s attempts "
                            "(status=%s)",
                            model_name,
                            attempt,
                            http_code,
                        )
                        continue
                    delay = _gemini_backoff(attempt_index)
                    logger.warning(
                        "Gemini rate limited / transient: model=%s attempt=%s "
                        "status=%s retry_in=%.2fs",
                        model_name,
                        attempt,
                        http_code,
                        delay,
                    )
                    await asyncio.sleep(delay)
                except Exception as err:
                    # Transport-level / unknown failures
                    last_error = err
                    if attempt >= config.GEMINI_MAX_RETRIES:
                        logger.warning(
                            "Gemini model %s transport failure (attempt=%s): %s",
                            model_name,
                            attempt,
                            type(err).__name__,
                        )
                        continue
                    delay = _gemini_backoff(attempt_index)
                    logger.warning(
                        "Gemini model %s transient error attempt=%s retry_in=%.2fs",
                        model_name,
                        attempt,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    if response and response.text:
                        return response.text
                    last_error = ValueError("Gemini returned no text content.")

            logger.warning("Gemini model %s failed, trying fallback...", model_name)

    raise GeminiUnavailable(
        f"All Gemini models failed. Last error: {type(last_error).__name__}"
    )


def _gemini_backoff(attempt_index: int) -> float:
    base = min(2 ** attempt_index, 8)
    return base if attempt_index else 1.0