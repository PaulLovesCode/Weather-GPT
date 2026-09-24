# WeatherGPT Backend (FastAPI)

Standalone FastAPI service behind the AtmosphereAI / WeatherGPT weather app. Provide live weather, 7-day and hourly forecasts, reverse geocoding, city search, and an AI chat assistant. Designed to be simple to run locally so any client (Web, Flutter, mobile) can consume it over HTTP.

---

## Prerequisites

- **Python 3.10+** (developed against 3.12)
- **Git**

---

## Setup

```bash
# 1. Clone / obtain the backend source, then enter the folder
cd backend

# 2. Create and activate a virtual environment
# Windows (PowerShell)
python -m venv venv
.\venv\Scripts\Activate.ps1

# Windows (CMD)
python -m venv venv
.\venv\Scripts\activate.bat

# macOS / Linux
python3 -m venv venv
source venv/bin/activate

# 3. Install pinned dependencies
pip install -r requirements.txt

# 4. Create your environment file
cp .env.example .env
#   -> open .env and set GEMINI_API_KEY (required for chat) and, optionally,
#      OPENROUTER_API_KEY (fallback for chat)
```

### API keys

| Key | Required | Used for |
|---|---|---|
| `GEMINI_API_KEY` | Yes for chat | WeatherGPT chat + intent parsing (Google AI Studio: https://aistudio.google.com) |
| `OPENROUTER_API_KEY` | Optional | Fallback for chat if Gemini fails (https://openrouter.ai) |

All weather/forecast/geocoding data comes from free public APIs (Open-Meteo, Nominatim, BigDataCloud) — **no key needed** for the non-chat endpoints.

> ⚠️ Never commit `.env`. It is already excluded via `.gitignore`. Generate your **own** keys — do not use anyone else's.

---

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

- API root: `http://127.0.0.1:8000`
- Interactive OpenAPI docs (Swagger UI): `http://127.0.0.1:8000/docs`
- Raw OpenAPI schema: `http://127.0.0.1:8000/openapi.json`

Use `--host 0.0.0.0` so a physical phone/Flutter app on the **same network** can reach it via your machine's LAN IP (e.g. `http://192.168.1.20:8000`). Use `--host 127.0.0.1` (as the root README does) when everything runs on one machine.

---

## API Reference

All responses are JSON. Errors use the shape:

```json
{
  "detail": "Human-readable message",
  "error": { "code": "CODE", "message": "Human-readable message", "retryable": false }
}
```

### Current weather + forecast + location (GPS) — recommended for mobile
`GET /api/current?lat={lat}&lon={lon}`

Returns everything for the frontend in one call: reverse-geocoded location, current weather, 7-day forecast, and 24h hourly forecast.

```json
{
  "location": { "name": "Kolkata", "country": "India", "latitude": 22.72, "longitude": 88.48 },
  "weather": {
    "location": { "latitude": 22.71, "longitude": 88.48 },
    "time": "2026-09-25T00:00",
    "temperature": 27.3,
    "feels_like": 31.2,
    "humidity": 78,
    "precipitation": 0.0,
    "wind_speed": 11.5,
    "wind_direction": 160,
    "condition": "Partly cloudy"
  },
  "forecast": [
    {
      "date": "2026-09-25",
      "temperature_max": 30.1,
      "temperature_min": 24.8,
      "precipitation": 2.4,
      "rain_probability": 80,
      "wind_speed_max": 18.0,
      "condition": "Thunderstorm"
    }
  ],
  "hourly": [
    {
      "time": "00:00",
      "raw_time": "2026-09-25T00:00",
      "temperature": 27.3,
      "rain_probability": 10,
      "condition": "Partly cloudy",
      "wind_speed": 11.5
    }
  ],
  "cached": false,
  "degraded": false,
  "source_status": { "weather": "fresh", "forecast": "fresh", "hourly": "fresh", "location": "fresh" }
}
```

### City-based weather
`GET /api/weather?city={city}`

```json
{
  "location": { "name": "Delhi", "latitude": 28.65, "longitude": 77.23, "country": "India", "admin1": "Delhi" },
  "weather": { "temperature": 32.1, "condition": "Clear sky", "...": "" },
  "cached": false,
  "degraded": false
}
```

If the city is not found: HTTP 200 with `{ "error": "Location not found" }`.

### 7-day + hourly forecast
`GET /api/forecast?city={city}` → `{ "location": {...}, "forecast": [...], "hourly": [...] }`

### City search (autocomplete / suggestions)
`GET /api/locations?city={city}` → `{ "results": [ { "name", "latitude", "longitude", "country", "admin1" } ] }`

### Coordinate variants
- `GET /api/weather/current?lat={lat}&lon={lon}`
- `GET /api/forecast/current?lat={lat}&lon={lon}`
- `GET /api/forecast/hourly?city={city}`
- `GET /api/forecast/hourly/current?lat={lat}&lon={lon}`

### Chat (AI assistant)
`POST /api/chat`

```json
// Body
{ "message": "Is it going to rain in Mumbai today?", "previous_location": "Mumbai" }
```

```json
// Response
{ "reply": "...", "location": { "name": "Mumbai", "latitude": 19.07, "longitude": 72.87 } }
```

`previous_location` lets the assistant answer follow-ups like "what about tomorrow?" without re-stating the city. If `message` is empty or longer than 4000 chars, you get HTTP 422.

---

## Behavior notes

- **Rate limits** (per IP): weather/current 30/min, forecast 20/min, chat 10/min, geocoding 10/min. Over the limit → HTTP 429.
- **Caching**: results are cached in memory (weather 5 min, forecast 15 min, geocoding 1 h). Repeated identical requests are deduplicated (single-flight) — one in-flight provider call serves concurrent waiters.
- **Stale fallback**: if Open-Meteo is briefly unreachable, a stale cached copy is returned with `degraded: true` instead of an error.
- **Chat**: multiple Gemini models are tried in order (`GEMINI_MODELS` config); a permanent model failure falls through to OpenRouter.
- **Reverse geocoding**: Nominatim first, then BigDataCloud, then coordinates-only fallback — so weather never blocks on a geocoder outage.

## Configuration (all overridable via `.env`)

See `.env.example` for the complete list — timeouts, retries, rate limits, cache TTLs, `GEMINI_MODELS`, `MAX_CHAT_MESSAGE_LENGTH`, etc. Defaults are already sensible for local development.

## Project layout

| File | Purpose |
|---|---|
| `main.py` | FastAPI app + all REST endpoints + error handlers |
| `config.py` | Env-driven configuration |
| `weather.py` | Open-Meteo weather/forecast access + mapping |
| `geocoding.py` | City search + reverse geocoding |
| `http_client.py` | Shared HTTP client with bounded retries |
| `cache.py` | TTL cache + single-flight + stale fallback |
| `ratelimit.py` | Per-IP sliding-window rate limiter |
| `llm.py` | LLM routing (Gemini → OpenRouter) |
| `intent.py` | Natural-language query → structured intent |
| `gemini_utils.py` | Gemini client + model fallback |
| `openrouter_utils.py` | OpenRouter client + retry |