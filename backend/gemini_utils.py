import os
import logging
from typing import Optional
from dotenv import load_dotenv
from google import genai
from google.genai import types

logger = logging.getLogger("weathergpt.gemini")

load_dotenv()

GEMINI_MODELS = [
    "gemini-3.6-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
]

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
    """Generate content using Gemini API with automatic model fallback."""
    client = get_gemini_client()
    if not client:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    config_kwargs = {
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
        "automatic_function_calling": types.AutomaticFunctionCallingConfig(disable=True),
    }

    if json_mode:
        config_kwargs["response_mime_type"] = "application/json"

    if system_instruction:
        config_kwargs["system_instruction"] = system_instruction

    config = types.GenerateContentConfig(**config_kwargs)

    last_error = None
    for model_name in GEMINI_MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config,
            )
            if response and response.text:
                return response.text
        except Exception as err:
            last_error = err
            logger.warning(f"Gemini model {model_name} failed: {err}. Trying next model...")

    raise RuntimeError(f"All Gemini models failed. Last error: {last_error}")
