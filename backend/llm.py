import os
from typing import Optional
from dotenv import load_dotenv

from gemini_utils import generate_gemini_response
from openrouter_utils import setup_client, complete_with_retry

load_dotenv()


async def generate_weather_response(
    user_message: str,
    weather_data: dict,
    forecast_data: list
):
    prompt = f"""
You are WeatherGPT, an AI weather assistant focused on India.

The user asked:
{user_message}

Use ONLY the weather data provided below.

CURRENT WEATHER:
{weather_data}

7-DAY FORECAST:
{forecast_data}

Rules:
- Never invent weather information.
- Give a concise, useful answer.
- Use Celsius and km/h.
- If the user asks about rain, mention rain probability when available.
- If the requested information is not available, say so clearly.
- Do not claim that Open-Meteo data is an official IMD warning.
- Do not create or imply an official warning.
- Speak naturally like a helpful weather assistant.
"""

    result: Optional[str] = None

    # 1. Try Gemini API first if GEMINI_API_KEY is configured
    if os.getenv("GEMINI_API_KEY"):
        try:
            result = await generate_gemini_response(prompt)
        except Exception as gemini_err:
            print(f"Gemini API LLM response fallback trigger: {gemini_err}")

    # 2. Fallback to OpenRouter if Gemini failed or wasn't configured
    if not result:
        client = setup_client()
        ok, res = await complete_with_retry(
            client,
            models=[
                "openrouter/auto",
                "meta-llama/llama-3.3-70b-instruct",
                "qwen/qwen-2.5-coder-32b-instruct",
            ],
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=300,
        )

        if not ok:
            raise RuntimeError(res)
        result = res

    return result