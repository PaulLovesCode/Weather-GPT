import asyncio
import logging

from openai import (
    AsyncOpenAI,
    APIConnectionError,
    APITimeoutError,
    RateLimitError,
    APIStatusError,
)

logger = logging.getLogger("weathergpt.llm")

MAX_RETRIES = 2
BACKOFF_SECONDS = [0.5, 1.5]
RETRIABLE_STATUS = {408, 409, 429, 500, 502, 503, 504}


def setup_client() -> AsyncOpenAI | None:
    import os
    from dotenv import load_dotenv

    load_dotenv()

    api_key = os.getenv("OPENROUTER_API_KEY")

    if not api_key:
        return None

    return AsyncOpenAI(
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
    )


def _is_retriable(exc: Exception) -> bool:
    if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError)):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code in RETRIABLE_STATUS
    return False


async def complete_with_retry(
    client: AsyncOpenAI | None,
    models: list[str],
    messages: list,
    **kwargs,
):
    """Call OpenRouter across the given models with retry + backoff.

    Returns ``(ok, content_or_error_message)``. Never raises for transient
    downstream failures.
    """
    if not client:
        return False, "OpenRouter client is not initialized (OPENROUTER_API_KEY not set)."

    last_error: Exception | None = None

    for model_name in models:
        for attempt in range(MAX_RETRIES):
            try:
                response = await client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    **kwargs,
                )
                content = response.choices[0].message.content

                if not content:
                    raise RuntimeError(
                        f"OpenRouter returned no text content (model={model_name})."
                    )

                return True, content

            except Exception as exc:
                last_error = exc

                # If model ID is invalid (400) or not found (404), skip to next model immediately
                if isinstance(exc, APIStatusError) and exc.status_code in {400, 404}:
                    logger.warning(
                        "OpenRouter model %s is invalid/unsupported (%s), skipping to next model...",
                        model_name,
                        exc,
                    )
                    break

                if not _is_retriable(exc):
                    logger.warning("OpenRouter non-retriable error for model %s: %s", model_name, exc)
                    break

                logger.warning(
                    "OpenRouter retriable error (model=%s attempt=%s): %s",
                    model_name,
                    attempt + 1,
                    exc,
                )

                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(BACKOFF_SECONDS[attempt])

        logger.warning(
            "OpenRouter model %s failed, trying fallback...",
            model_name,
        )

    return False, f"OpenRouter is temporarily unavailable: {last_error}"
