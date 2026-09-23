import os

from dotenv import load_dotenv
from openai import AsyncOpenAI


load_dotenv()

api_key = os.getenv("OPENROUTER_API_KEY")

if not api_key:
    raise RuntimeError("OPENROUTER_API_KEY is not set")


client = AsyncOpenAI(
    api_key=api_key,
    base_url="https://openrouter.ai/api/v1",
)


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

    response = await client.chat.completions.create(
        model="openrouter/free",
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.2,
        max_tokens=300,
    )

    message = response.choices[0].message

    if not message.content:
        raise RuntimeError(
            f"OpenRouter returned no text content.\n"
            f"Response: {response}"
        )

    return message.content