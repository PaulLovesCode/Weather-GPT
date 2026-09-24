import json
import os
import re
from typing import Literal, Optional
from pydantic import BaseModel

from gemini_utils import generate_gemini_response
from openrouter_utils import setup_client, complete_with_retry


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
    ] = "general"

    time_period: Literal[
        "now",
        "today",
        "tomorrow",
        "next_7_days",
        "unknown"
    ] = "today"


async def understand_weather_question(
    user_message: str
) -> WeatherIntent:

    system_instruction = (
        "You are an intent parser. Extract a JSON object containing keys:\n"
        '1. "location": City/place name or null if no location is mentioned.\n'
        '2. "request_type": one of ["current_weather", "forecast", "rain", "temperature", "humidity", "wind", "general"].\n'
        '3. "time_period": one of ["now", "today", "tomorrow", "next_7_days", "unknown"].\n'
        "Return strictly valid JSON only. Do not add explanations or formatting."
    )

    prompt = f'User query: "{user_message}"'

    result: Optional[str] = None

    # 1. Try Gemini API first if GEMINI_API_KEY is set
    if os.getenv("GEMINI_API_KEY"):
        try:
            result = await generate_gemini_response(
                prompt,
                system_instruction=system_instruction,
                json_mode=True,
                temperature=0.0,
                max_output_tokens=300,
            )
        except Exception as gemini_err:
            print(f"Gemini API intent extraction fallback trigger: {gemini_err}")

    # 2. Fallback to OpenRouter if Gemini failed
    if not result:
        client = setup_client()
        ok, res = await complete_with_retry(
            client,
            models=[
                "openrouter/auto",
                "meta-llama/llama-3.3-70b-instruct",
                "qwen/qwen-2.5-coder-32b-instruct",
            ],
            messages=[
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": prompt}
            ],
            temperature=0,
            max_tokens=300,
        )
        if ok:
            result = res

    if not result:
        return WeatherIntent(location=None, request_type="general", time_period="today")

    # Clean up JSON formatting
    cleaned_result = result.strip()
    if cleaned_result.startswith("```"):
        cleaned_result = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned_result)
        cleaned_result = re.sub(r"\n?```$", "", cleaned_result).strip()

    try:
        data = json.loads(cleaned_result)
        return WeatherIntent.model_validate(data)
    except Exception as exc:
        print(f"Intent JSON parsing fallback: {exc} | Raw text: {cleaned_result}")
        loc_match = re.search(r'"location"\s*:\s*"([^"]+)"', cleaned_result)
        extracted_location = loc_match.group(1) if loc_match else None
        return WeatherIntent(
            location=extracted_location,
            request_type="general",
            time_period="today"
        )