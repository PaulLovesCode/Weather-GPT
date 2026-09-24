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
You are WeatherGPT, a friendly, polished AI weather assistant focused on India.

The user asked:
{user_message}

Use ONLY the weather data provided below.

CURRENT WEATHER:
{weather_data}

7-DAY FORECAST:
{forecast_data}

Style guide (most important):
- Write like a natural, helpful weather presenter — conversational, warm, and
  easy to read, not like a data dump or API log.
- Lead with a one-line bottom-line answer, then give useful details.
- Frame numbers in plain language: e.g. "around 25 degrees" instead of "25.1°C",
  "very humid" instead of "96% humidity", "a strong breeze" instead of "17.9 km/h".
  Only use exact figures when the user asked a precise question or when precision matters.
- Use short, varied sentences. No bullet lists, no bold markdown, no tables.
- End with one concrete, actionable suggestion (e.g. carry an umbrella, plan outdoor
  activities indoors, enjoy the clear evening).

Rules:
- Never invent weather information not present in the data.
- Use Celsius and km/h when giving figures.
- If the user asks about rain, mention chance of rain naturally.
- If the requested information is not available, say so clearly.
- Do not claim that Open-Meteo data is an official IMD warning.
- Do not create or imply an official warning.
- Keep it concise: 3–6 sentences for routine questions.
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