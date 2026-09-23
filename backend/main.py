import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from llm import generate_weather_response
from weather import get_weather, get_forecast, get_hourly_forecast
from geocoding import get_coordinates, search_locations, reverse_geocode
from intent import understand_weather_question


app = FastAPI(
    title="WeatherGPT API",
    description="AI-powered conversational weather intelligence platform",
    version="0.1.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "message": "WeatherGPT API is running",
        "version": "0.1.0"
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy"
    }


# ============================================================
# CITY-BASED WEATHER
# ============================================================

@app.get("/api/weather")
async def weather(city: str):
    location = await get_coordinates(city)

    if location is None:
        return {
            "error": "Location not found"
        }

    weather_data = await get_weather(
        location["latitude"],
        location["longitude"]
    )

    return {
        "location": location,
        "weather": weather_data
    }


# ============================================================
# COORDINATE-BASED WEATHER
# Used by browser's current location
# ============================================================

@app.get("/api/weather/current")
async def current_weather(
    lat: float,
    lon: float
):
    location = await reverse_geocode(lat, lon)
    weather_data = await get_weather(lat, lon)

    return {
        "location": location,
        "weather": weather_data
    }


# ============================================================
# CITY LOCATION
# ============================================================

@app.get("/api/location")
async def location(city: str):
    result = await get_coordinates(city)

    if result is None:
        return {
            "error": "Location not found"
        }

    return result


@app.get("/api/locations")
async def locations(city: str):
    results = await search_locations(city)

    if not results:
        return {
            "error": "Location not found"
        }

    return {
        "results": results
    }


# ============================================================
# CITY-BASED FORECAST
# ============================================================

@app.get("/api/forecast")
async def forecast(city: str):
    location = await get_coordinates(city)

    if location is None:
        return {
            "error": "Location not found"
        }

    forecast_data, hourly_data = await asyncio.gather(
        get_forecast(location["latitude"], location["longitude"]),
        get_hourly_forecast(location["latitude"], location["longitude"]),
    )

    return {
        "location": location,
        "forecast": forecast_data,
        "hourly": hourly_data
    }


# ============================================================
# COORDINATE-BASED FORECAST
# Used by browser's current location
# ============================================================

@app.get("/api/forecast/current")
async def current_forecast(
    lat: float,
    lon: float
):
    location, forecast_data, hourly_data = await asyncio.gather(
        reverse_geocode(lat, lon),
        get_forecast(lat, lon),
        get_hourly_forecast(lat, lon),
    )

    return {
        "location": location,
        "forecast": forecast_data,
        "hourly": hourly_data
    }


# ============================================================
# DEDICATED HOURLY FORECAST
# ============================================================

@app.get("/api/forecast/hourly")
async def hourly_forecast(city: str):
    location = await get_coordinates(city)
    if location is None:
        return {"error": "Location not found"}

    hourly_data = await get_hourly_forecast(
        location["latitude"], location["longitude"]
    )
    return {
        "location": location,
        "hourly": hourly_data
    }


@app.get("/api/forecast/hourly/current")
async def current_hourly_forecast(lat: float, lon: float):
    location, hourly_data = await asyncio.gather(
        reverse_geocode(lat, lon),
        get_hourly_forecast(lat, lon),
    )
    return {
        "location": location,
        "hourly": hourly_data
    }


# ============================================================
# CHAT
# ============================================================

class ChatRequest(BaseModel):
    message: str
    previous_location: str | None = None


class IntentRequest(BaseModel):
    message: str


@app.post("/api/chat")
async def chat(request: ChatRequest):

    message = request.message

    # Understand the user's question using OpenRouter
    intent = await understand_weather_question(message)

    # Use the location detected by the LLM
    city = intent.location

    # If no location was mentioned, use the previous location
    if not city:
        city = request.previous_location

    # Still no location available
    if not city:
        return {
            "reply": "Please tell me which city you want weather information for."
        }

    # Convert city name to coordinates
    location = await get_coordinates(city)

    if location is None:
        return {
            "reply": f"I couldn't find the location '{city}'."
        }

    # Get current weather
    weather_data = await get_weather(
        location["latitude"],
        location["longitude"]
    )

    # Get 7-day forecast
    forecast_data = await get_forecast(
        location["latitude"],
        location["longitude"]
    )

    # Generate natural-language response
    reply = await generate_weather_response(
        message,
        weather_data,
        forecast_data
    )

    return {
        "reply": reply,
        "location": location
    }


# ============================================================
# TEST INTENT
# ============================================================

@app.post("/api/test-intent")
async def test_intent(request: IntentRequest):

    intent = await understand_weather_question(
        request.message
    )

    return intent.model_dump()