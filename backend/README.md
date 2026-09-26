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

To run the test suite, also install the test-only dependencies:

```bash
pip install pytest pytest-asyncio
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

## Tests

```bash
# From the backend/ directory, with the virtualenv activated:
python -m pytest -q
```

The suite mocks every external call, so it needs no API keys and no network
access. Tests import the modules by bare name (`import main`, `import config`),
which means **pytest must be run from `backend/`** — `python -m pytest` from the
repository root will not resolve them.

| File | Covers |
|---|---|
| `tests/test_weather_resilience.py` | 200/429 handling and `Retry-After` parsing, circuit breaker opening and half-open cooldown, stale-cache fallback, single-flight dedup, city-geocoding cache, `/api/current` response shape |
| `tests/test_geocoding_ranking.py` | Provider relevance order is preserved (no alphabetical re-sort), exact-match and tie-break selection, full candidate list caching, one upstream call for dropdown-then-enter, coordinates beating a conflicting city name, out-of-range coordinate rejection |
| `tests/test_ip_geolocation.py` | Loopback/private/reserved address rejection, leftmost `X-Forwarded-For` entry, per-address cache keying, graceful `unavailable` degradation, `IP_GEO_ENABLED=false` short-circuit |

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

Supplying `lat` and `lon` **skips geocoding entirely** and echoes `name` back as
the display label. This is what the search UI uses after you pick a candidate,
so the forecast always belongs to the place you actually chose rather than to a
fresh geocoding of the same (possibly ambiguous) name:

```
GET /api/weather?lat=38.9517&lon=-92.3341&name=Columbia&country=United States&admin1=Missouri
```

`name` is optional (falls back to the rounded coordinates), `country`/`admin1`
are optional passthrough. Out-of-range or non-finite coordinates give HTTP 400.

### 7-day + hourly forecast
`GET /api/forecast?city={city}` → `{ "location": {...}, "forecast": [...], "hourly": [...] }`

Accepts the same optional `lat`/`lon`/`name`/`country`/`admin1` parameters as
`/api/weather`, with identical coordinate semantics.

### City search (autocomplete / suggestions)
`GET /api/locations?city={city}` → `{ "results": [ { "name", "latitude", "longitude", "country", "admin1", "population", "feature_code", "timezone" } ] }`

Results are returned in **the geocoding provider's relevance order and are never
re-sorted** — this list is what the search dropdown renders, so any reordering
here would resolve queries to places the user never chose.

Results are cached as a list (not as a single picked candidate) for
`CITY_SEARCH_CACHE_TTL` seconds, keyed on the lowercased query. Caching the list
means a lookup never locks in one interpretation of an ambiguous name, and the
dropdown lookup plus the follow-up `/api/weather` + `/api/forecast` pair share a
single upstream request.

### Coarse IP location (background refinement only)
`GET /api/location/by-ip` → `{ "name", "latitude", "longitude", "country", "admin1" }`

Resolves a *rough* city for the caller. The client only reaches for this after the
browser denies geolocation, and it always renders a time-zone-derived city first,
so this endpoint is never on the critical path. Turning it off costs accuracy
but nothing else.

- The caller address is taken from the **leftmost** `X-Forwarded-For` entry when
  present, otherwise `request.client.host`. Behind a proxy or platform router the
  socket address is the *proxy's*, which would otherwise place every visitor in
  the same city.
- Loopback, link-local, RFC1918/RFC4193 private, reserved, and documentation
  ranges are refused **locally**, so nothing leaves the process and the endpoint
  is a clean no-op under `localhost`.
- The provider's `region` field is projected onto `admin1`. Results are cached
  per address for `IP_GEO_CACHE_TTL` seconds.
- **Every** failure returns HTTP 200 with an `error` key — `disabled`,
  `private_ip`, or `unavailable` — never a 4xx/5xx. The client already has a
  city on screen, and it treats all of these the same way.
- `IP_GEO_ENABLED=false` keeps the caller's IP entirely local. Otherwise the IP
  address is sent to the provider named by `IP_GEO_URL`.

### Coordinate variants
- `GET /api/weather/current?lat={lat}&lon={lon}`
- `GET /api/forecast/current?lat={lat}&lon={lon}`
- `GET /api/forecast/hourly?city={city}`
- `GET /api/forecast/hourly/current?lat={lat}&lon={lon}`

### Chat (AI assistant)
`POST /api/chat`

```json
// Body
{
  "message": "Is it going to rain in Mumbai today?",
  "previous_location": "Mumbai",
  "history": ["Will it be sunny this weekend?"]
}
```

```json
// Response
{ "reply": "...", "location": { "name": "Mumbai", "latitude": 19.07, "longitude": 72.87 } }
```

`previous_location` lets the assistant answer follow-ups like "what about tomorrow?" without re-stating the city. `history` is optional and capped at `MAX_CHAT_HISTORY` (20) entries. If `message` is empty or longer than `MAX_CHAT_MESSAGE_LENGTH` (4000 chars), or `history` is too long, you get HTTP 422.

---

## Behavior notes

- **Rate limits** (per IP): weather/current 30/min, forecast 20/min, chat 10/min, geocoding 10/min, city search 60/min, IP location 30/min, `/api/location` single-answer 20/min. Over the limit → HTTP 429 with `Retry-After`.
- **Caching**: results are cached in memory (weather 5 min, hourly 5 min, forecast 15 min, geocoding 1 h, city search 10 min, IP geo 1 h). Coordinates are rounded to `CACHE_ROUND_PRECISION` decimals before keying so GPS jitter does not defeat the cache. Repeated identical requests are deduplicated (single-flight) — one in-flight provider call serves concurrent waiters.
- **Stale fallback**: if Open-Meteo is briefly unreachable, a stale cached copy (up to `STALE_CACHE_MAX_AGE` seconds old) is returned with `degraded: true` instead of an error.
- **Retries**: only transient failures are retried (timeouts, transport errors, HTTP 408/425/429/5xx) with exponential backoff. A 400/401/403/404 fails immediately.
- **Circuit breaker**: repeated HTTP 429s from Open-Meteo open a per-provider circuit for `OPEN_METEO_429_COOLDOWN` seconds, after which a single probe request decides whether to close it again. While open, requests fail fast into the stale-cache path instead of hammering the provider.
- **Chat**: multiple Gemini models are tried in order (`GEMINI_MODELS` config); a permanent model failure falls through to OpenRouter.
- **Reverse geocoding**: Nominatim first, then BigDataCloud, then coordinates-only fallback — so weather never blocks on a geocoder outage. The geocoder has its own rate-limit budget; being throttled degrades to the coordinate fallback rather than failing the request.

## Configuration (all overridable via `.env`)

See `.env.example` for the templated list — LLM providers, HTTP timeouts, retries, rate limits, cache TTLs, `MAX_CHAT_*`, `IP_GEO_*`, and `CORS_ORIGINS`. Defaults are already sensible for local development.

Three circuit-breaker knobs are read from the environment but are not in `.env.example` yet, so set them only if you need to tune Open-Meteo throttling:

| Variable | Default | Meaning |
|---|---|---|
| `OPEN_METEO_MAX_RETRIES` | `1` | Extra retries granted specifically to HTTP 429 responses |
| `OPEN_METEO_429_COOLDOWN` | `30` | Seconds the circuit stays open after consecutive 429s |
| `OPEN_METEO_CIRCUIT_FAILURE_THRESHOLD` | `3` | Consecutive 429s before the circuit opens |

## Project layout

| File | Purpose |
|---|---|
| `main.py` | FastAPI app + all REST endpoints + error handlers |
| `config.py` | Env-driven configuration |
| `weather.py` | Open-Meteo weather/forecast access + mapping |
| `geocoding.py` | City search + reverse geocoding |
| `http_client.py` | Shared HTTP client with bounded retries + circuit breaker |
| `cache.py` | TTL cache + single-flight + stale fallback |
| `ratelimit.py` | Per-IP sliding-window rate limiter |
| `llm.py` | LLM routing (Gemini → OpenRouter) |
| `intent.py` | Natural-language query → structured intent |
| `gemini_utils.py` | Gemini client + model fallback |
| `openrouter_utils.py` | OpenRouter client + retry |
| `tests/` | pytest suite (resilience, geocoding ranking, IP geolocation) |
