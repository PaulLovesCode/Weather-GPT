import os
import json
from typing import Literal, Optional

from dotenv import load_dotenv
from pydantic import BaseModel
from openai import AsyncOpenAI


load_dotenv()

api_key = os.getenv("OPENROUTER_API_KEY")

if not api_key:
    raise RuntimeError("OPENROUTER_API_KEY is not set")


client = AsyncOpenAI(
    api_key=api_key,
    base_url="https://openrouter.ai/api/v1",
)


class WeatherIntent(BaseModel):
    location: Optional[str] = None

    request_type: Literal[
        "current_weather",
        "forecast",
        "rain",
        "temperature",
        "humidity",
        "wind",
        "general"
    ]

    time_period: Literal[
        "now",
        "today",
        "tomorrow",
        "next_7_days",
        "unknown"
    ]


async def understand_weather_question(
    user_message: str
) -> WeatherIntent:

    prompt = f"""
You are the intent extraction system for WeatherGPT.

Analyze the user's weather question.

Extract:

1. location:
   - The city or place the user is asking about.
   - Return null if no location is mentioned.

2. request_type:
   - current_weather
   - forecast
   - rain
   - temperature
   - humidity
   - wind
   - general

3. time_period:
   - now
   - today
   - tomorrow
   - next_7_days
   - unknown

Important:
- Do not invent a location.
- Do not answer the user's question.
- Return ONLY valid JSON.
- Do not use markdown.
- Do not add explanations.

Required JSON format:

{{
  "location": "Mumbai",
  "request_type": "rain",
  "time_period": "tomorrow"
}}

User question:
{user_message}
"""

    response = await client.chat.completions.create(
        model="qwen/qwen3.8-27b:free",
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0,
        max_tokens=100,
    )

    # Get the model response safely
    message = response.choices[0].message

    result = message.content

    if not result:
        raise RuntimeError(
            f"OpenRouter returned no text content. Response: {response}"
        )

    # Remove possible markdown code fences
    result = result.strip()

    if result.startswith("```"):
        result = result.replace("```json", "")
        result = result.replace("```", "")
        result = result.strip()

    try:
        data = json.loads(result)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"OpenRouter returned invalid JSON: {result}"
        ) from exc

    return WeatherIntent.model_validate(data)