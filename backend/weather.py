import httpx


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

    return weather_codes.get(weather_code, "Unknown")


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
            "wind_speed_10m"
        ),
        "timezone": "auto",
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)

    response.raise_for_status()

    data = response.json()
    current = data["current"]

    return {
        "location": {
            "latitude": data["latitude"],
            "longitude": data["longitude"],
        },
        "time": current["time"],
        "temperature": current["temperature_2m"],
        "feels_like": current["apparent_temperature"],
        "humidity": current["relative_humidity_2m"],
        "precipitation": current["precipitation"],
        "wind_speed": current["wind_speed_10m"],
        "condition": get_weather_description(
            current["weather_code"]
        ),
    }


async def get_forecast(latitude: float, longitude: float):
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

    async with httpx.AsyncClient() as client:
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