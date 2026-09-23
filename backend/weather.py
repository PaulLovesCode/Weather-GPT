import httpx
from datetime import datetime

WEATHER_HEADERS = {
    "User-Agent": "AtmosphereAI/1.0 (contact@weathergpt.local; https://weathergpt.local)"
}


def get_weather_description(weather_code: int) -> str:
    weather_codes = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Slight snow",
        73: "Moderate snow",
        75: "Heavy snow",
        80: "Slight rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        95: "Thunderstorm",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail",
    }
    return weather_codes.get(weather_code, "Partly cloudy")


async def get_weather(latitude: float, longitude: float):
    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": (
            "temperature_2m,"
            "relative_humidity_2m,"
            "apparent_temperature,"
            "precipitation,"
            "weather_code,"
            "wind_speed_10m,"
            "wind_direction_10m"
        ),
        "timezone": "auto",
    }

    async with httpx.AsyncClient(headers=WEATHER_HEADERS) as client:
        response = await client.get(url, params=params)

    response.raise_for_status()

    data = response.json()
    current = data["current"]

    return {
        "location": {
            "latitude": data["latitude"],
            "longitude": data["longitude"],
        },
        "time": current.get("time"),
        "temperature": current.get("temperature_2m", 0.0),
        "feels_like": current.get("apparent_temperature", 0.0),
        "humidity": current.get("relative_humidity_2m", 0),
        "precipitation": current.get("precipitation", 0.0),
        "wind_speed": current.get("wind_speed_10m", 0.0),
        "wind_direction": current.get("wind_direction_10m", 0),
        "condition": get_weather_description(
            current.get("weather_code", 0)
        ),
    }


async def get_hourly_forecast(latitude: float, longitude: float):
    """Fetch real 24-hour hourly forecast telemetry."""
    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": (
            "temperature_2m,"
            "precipitation_probability,"
            "weather_code,"
            "wind_speed_10m"
        ),
        "timezone": "auto",
        "forecast_hours": 24,
    }

    async with httpx.AsyncClient(headers=WEATHER_HEADERS) as client:
        response = await client.get(url, params=params)

    response.raise_for_status()

    data = response.json()
    hourly_raw = data.get("hourly", {})
    times = hourly_raw.get("time", [])
    temps = hourly_raw.get("temperature_2m", [])
    probs = hourly_raw.get("precipitation_probability", [])
    codes = hourly_raw.get("weather_code", [])
    winds = hourly_raw.get("wind_speed_10m", [])

    hourly_list = []
    for i in range(min(len(times), 24)):
        raw_time = times[i]
        try:
            # Parse '2026-09-24T14:00' to '14:00'
            formatted_time = datetime.fromisoformat(raw_time).strftime("%H:%M")
        except Exception:
            formatted_time = raw_time.split("T")[-1][:5] if "T" in raw_time else raw_time

        hourly_list.append({
            "time": formatted_time,
            "raw_time": raw_time,
            "temperature": temps[i] if i < len(temps) else 0.0,
            "rain_probability": probs[i] if i < len(probs) else 0,
            "condition": get_weather_description(codes[i] if i < len(codes) else 0),
            "wind_speed": winds[i] if i < len(winds) else 0.0,
        })

    return hourly_list


async def get_forecast(latitude: float, longitude: float):
    """Fetch 7-day daily forecast and 24-hour hourly forecast."""
    url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": (
            "weather_code,"
            "temperature_2m_max,"
            "temperature_2m_min,"
            "precipitation_sum,"
            "precipitation_probability_max,"
            "wind_speed_10m_max"
        ),
        "timezone": "auto",
        "forecast_days": 7,
    }

    async with httpx.AsyncClient(headers=WEATHER_HEADERS) as client:
        response = await client.get(url, params=params)

    response.raise_for_status()

    data = response.json()
    daily = data["daily"]

    forecast = []

    for i in range(len(daily["time"])):
        forecast.append({
            "date": daily["time"][i],
            "temperature_max": daily["temperature_2m_max"][i],
            "temperature_min": daily["temperature_2m_min"][i],
            "precipitation": daily["precipitation_sum"][i],
            "rain_probability": daily["precipitation_probability_max"][i],
            "wind_speed_max": daily["wind_speed_10m_max"][i],
            "condition": get_weather_description(
                daily["weather_code"][i]
            ),
        })

    return forecast