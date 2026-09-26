# AtmosphereAI / WeatherGPT 🌤️🤖

AtmosphereAI (WeatherGPT) is an AI-powered, full-stack weather intelligence platform. It pairs live atmospheric telemetry and multi-day forecasting with a conversational AI assistant capable of answering natural-language weather queries.

---

## 🌟 Features

- **Live Atmospheric Telemetry**: Real-time temperature, humidity, precipitation, wind direction & speed (with Beaufort scale), and a "Feels Like" thermal index.
- **24-Hour & 7-Day Forecasting**: High-precision hourly temperature & precipitation curves along with 7-day temperature range predictions.
- **Interactive Weather Map**: A full-screen Leaflet map with OpenStreetMap / Esri satellite base layers, live RainViewer rain radar, and temperature / wind / rain overlays sampled straight from the Open-Meteo grid. Tap any point to load that exact location.
- **Dynamic Weather Ambiance**: A three.js WebGL sky shader (day, dawn, dusk and night gradients with a moving sun) layered with a High-DPI Canvas particle engine for rain, snow, drifting fog, thunderstorm lightning, and sun/stardust motes — all automatic, and all disabled under `prefers-reduced-motion`.
- **WeatherGPT AI Assistant**: Integrated natural language drawer powered by Google Gemini (`gemini-3.5-flash-lite`, configurable via `GEMINI_MODELS`) and OpenRouter fallback for real-time weather Q&A.
- **Global Search & Geolocation**: Debounced autocomplete over worldwide city search — pick the exact candidate you want and its coordinates are sent straight through, so an ambiguous name like "Columbia" can never resolve to a different city. Plus instant coordinate detection via browser geolocation and near-identical reverse geocoding (Nominatim + BigDataCloud fallback).
- **Responsive & installable**: Mobile-first layout that adapts from 360 px phones to wide desktops, plus a web manifest and service worker so the app can be installed to the home screen.
- **Resilience built-in**: TTL caching, per-IP rate limiting, a provider circuit breaker for Open-Meteo 429s, bounded retries with exponential backoff, single-flight deduplication and stale-cache fallback keep the app fast and safe under load.
- **Unit Customization**: Persistent Celsius ($^\circ\text{C}$) and Fahrenheit ($^\circ\text{F}$) unit switching via `localStorage`.

---

## 🏗️ Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Framer Motion, Lucide Icons, Leaflet, three.js, Canvas Confetti
- **Backend**: Python 3.10+, FastAPI, Uvicorn, HTTPX, Pydantic, Google GenAI SDK, OpenAI SDK (OpenRouter integration)
- **Weather Data**: Open-Meteo Weather APIs, OpenStreetMap / Esri / RainViewer tiles, OpenStreetMap Geocoding

---

## 📋 Prerequisites

Before running the project, make sure you have installed:
- **Node.js**: v20.9.0 or higher (required by Next.js 16)
- **npm** or **pnpm** / **yarn**
- **Python**: v3.10 or higher
- **Git**

---

## ⚙️ Project Setup & Installation

### 1. Clone the Repository
```bash
git clone <repository-url>
cd Weather2
```

---

### 2. Backend Setup (FastAPI)

1. **Navigate to the backend directory**:
   ```bash
   cd backend
   ```

2. **Create and activate a virtual environment**:
   - **Windows (PowerShell)**:
     ```powershell
     python -m venv venv
     .\venv\Scripts\Activate.ps1
     ```
   - **Windows (CMD)**:
     ```cmd
     python -m venv venv
     .\venv\Scripts\activate.bat
     ```
   - **macOS / Linux**:
     ```bash
     python3 -m venv venv
     source venv/bin/activate
     ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment Variables**:
   Copy the template and fill in your keys:
   ```bash
   cp .env.example .env
   ```
   ```env
   # Google Gemini API key (recommended)
   GEMINI_API_KEY=your_gemini_api_key_here

   # OpenRouter API key (optional fallback)
   OPENROUTER_API_KEY=your_openrouter_api_key_here

   # Allowed browser origins, comma-separated, no trailing slashes.
   # The built-in default is localhost only, so set this to your own frontend
   # domain(s) or a hosted frontend will be blocked by CORS.
   CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
   ```
   `.env.example` documents every supported knob — timeouts, retries, rate
   limits, cache TTLs, `GEMINI_MODELS`, and the `IP_GEO_*` settings. All
   weather, forecast and geocoding endpoints work **without any API key**.

---

### 3. Frontend Setup (Next.js)

1. **Open a new terminal and navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env.local` file in the `frontend/` directory:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```
   The backend must be reachable at this URL. Geolocation is treated as a
   secure context on `localhost`, so GPS works in development without HTTPS.

---

## 🚀 Running the Application

To run the full stack locally, start both the backend and frontend servers in separate terminals:

### Step 1: Start Backend Server
```bash
# In the backend/ directory with venv activated:
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
- API will be accessible at: `http://127.0.0.1:8000`
- Interactive Swagger API docs: `http://127.0.0.1:8000/docs`

### Step 2: Start Frontend Development Server
```bash
# In the frontend/ directory:
npm run dev
```
- Web Application will be available at: `http://localhost:3000`

### How the app decides your location

On load the app picks the most precise source it can, and a better answer always
replaces a worse one regardless of which arrives first:

| Priority | Source | Notes |
|----------|--------|-------|
| 1 (best) | **GPS** | Only if you grant permission |
| 2 | **IP** | Used only after GPS is refused; needs `IP_GEO_ENABLED=true` |
| 3 | **Time zone** | Immediate, no network, usually right |
| 4 (last) | **Fixed default** | London, with a visible notice |

- The time-zone city is rendered immediately, so the first paint never waits on
  the permission prompt. A GPS grant then replaces it.
- A dismissible notice explains when a fallback is being shown, and offers a
  **Use my location** button to retry GPS on demand.
- Once you search, pick a suggestion, or choose a point on the map, that choice
  is locked in for the session. No automatic source can move you afterwards.
- `localhost` is treated as a secure context, so geolocation works in
  development. Over plain HTTP on a LAN address it does not, and the app says so.
- Set `IP_GEO_ENABLED=false` to keep your IP entirely local; the app then
  degrades to GPS → time zone → fixed default. Otherwise the caller's IP
  address is sent to the provider configured by `IP_GEO_URL`.

### Picking a place on the map

The **Map** button in the header opens a full-screen Leaflet view:

- **Base layers**: OpenStreetMap streets or Esri satellite imagery.
- **Overlays**: temperature, wind, or rain — sampled from the Open-Meteo grid
  at a resolution that follows the zoom level, then drawn as a colour layer.
- **Rain radar**: RainViewer tiles, animated over the base map.
- **Selecting a point** loads the full dashboard for those exact coordinates and
  counts as an explicit choice, so it locks out automatic location detection for
  the session just like picking a search suggestion does.

The map bundle is loaded with `next/dynamic`, so Leaflet is only downloaded when
the modal is actually opened.

---

## 🧪 Running the Tests

The backend ships with a `pytest` suite covering the parts that are easy to get
subtly wrong: provider failure handling and geocoding ranking.

```bash
# From the backend/ directory, with the virtualenv activated:
pip install pytest pytest-asyncio
python -m pytest -q
```

| File | Covers |
|---|---|
| `backend/tests/test_weather_resilience.py` | Open-Meteo retries and 429 handling, circuit breaker open/half-open, stale-cache fallback, single-flight dedup, `/api/current` response shape |
| `backend/tests/test_geocoding_ranking.py` | Provider-order preservation in `/api/locations`, exact-match and tie-break selection, candidate caching, coordinate-over-city resolution |
| `backend/tests/test_ip_geolocation.py` | Private/reserved address rejection, `X-Forwarded-For` handling, per-address caching, graceful degradation when the provider fails |

Tests import the app modules directly, so they must be run from `backend/`. No
API keys and no network access are required — every external call is mocked.

Frontend checks:

```bash
# From the frontend/ directory:
npm run lint
npm run build
```

---

## 📁 Project Structure

```text
Weather2/
├── README.md               # Root documentation
├── .gitignore
│
├── backend/                # FastAPI Backend
│   ├── main.py             # FastAPI entrypoint and REST endpoints
│   ├── config.py           # Env-driven config (timeouts, limits, TTLs, models)
│   ├── weather.py          # Open-Meteo weather integration & mapping
│   ├── geocoding.py        # Location search + Nominatim/BigDataCloud reverse geo
│   ├── http_client.py      # Shared httpx client with bounded retries + circuit breaker
│   ├── cache.py            # TTL cache with single-flight dedup & stale fallback
│   ├── ratelimit.py        # Per-IP sliding-window rate limiter
│   ├── intent.py           # Natural language query parsing
│   ├── llm.py              # LLM routing layer (Gemini / OpenRouter)
│   ├── gemini_utils.py     # Google GenAI client with model fallback
│   ├── openrouter_utils.py # OpenRouter client with retry logic
│   ├── tests/              # pytest suite (resilience, geocoding, IP geo)
│   ├── requirements.txt    # Python dependencies (pinned)
│   ├── .env.example        # Template for environment secrets
│   ├── README.md           # Backend API reference (for external consumers)
│   └── .env                # Backend environment secrets (not committed)
│
└── frontend/               # Next.js 16 Frontend
    ├── app/
    │   ├── components/     # UI (cards, gauges, sky canvas, map, chat drawer)
    │   ├── hooks/          # useTimeOfDay (shared day/night phase detection)
    │   ├── types/          # TypeScript interfaces for weather & chat data
    │   ├── utils/          # API callers, formatters, location resolution
    │   ├── globals.css     # Global styles & Tailwind CSS v4 setup
    │   ├── manifest.ts     # PWA manifest (installable app)
    │   ├── layout.tsx      # Root layout
    │   └── page.tsx        # Main dashboard page
    ├── public/             # PWA assets (icons, sw.js)
    ├── package.json        # Frontend dependencies and scripts
    ├── AGENTS.md           # Next.js agent notes (auto-generated)
    └── .env.local          # Frontend environment variables (not committed)
```

---

## 🔌 API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | API status check |
| `GET` | `/api/health` | Healthcheck endpoint |
| `GET` | `/api/weather?city={city}` | Get current weather for a city |
| `GET` | `/api/weather?lat=&lon=&name=` | Get current weather for explicit coordinates (skips geocoding) |
| `GET` | `/api/forecast?city={city}` | Get 7-day & hourly forecast for a city |
| `GET` | `/api/forecast?lat=&lon=&name=` | Get 7-day & hourly forecast for explicit coordinates (skips geocoding) |
| `GET` | `/api/current?lat={lat}&lon={lon}` | Combined current + forecast + hourly + location for GPS coordinates |
| `GET` | `/api/weather/current?lat={lat}&lon={lon}` | Get current weather telemetry by coordinates |
| `GET` | `/api/forecast/current?lat={lat}&lon={lon}` | Get forecast by coordinates |
| `GET` | `/api/forecast/hourly?city={city}` | Hourly forecast for a city |
| `GET` | `/api/forecast/hourly?lat=&lon=&name=` | Hourly forecast for explicit coordinates (skips geocoding) |
| `GET` | `/api/forecast/hourly/current?lat={lat}&lon={lon}` | Hourly forecast by coordinates |
| `GET` | `/api/location?city={city}` | Resolve a city name to a single best-guess location |
| `GET` | `/api/locations?city={city}` | Search city candidates, in provider relevance order (backs the search autocomplete) |
| `GET` | `/api/location/by-ip` | Coarse city for the caller, used only to refine a denied geolocation |
| `POST` | `/api/chat` | Send conversational prompt to WeatherGPT AI |
| `POST` | `/api/test-intent` | Parse a query into a structured intent (debug) |

Interactive OpenAPI docs are served at `http://127.0.0.1:8000/docs`, and the raw
schema at `http://127.0.0.1:8000/openapi.json`. Full request/response examples
live in [`backend/README.md`](backend/README.md).

---

## 🛡️ Rate Limits & Failure Behavior

| Endpoint scope | Default limit (per IP) |
|---|---|
| `/api/weather`, `/api/current` | 30/min |
| `/api/forecast*` | 20/min |
| `/api/chat`, `/api/test-intent` | 10/min |
| `/api/location` (reverse geocode) | 10/min |
| `/api/locations` (search) | 60/min |
| `/api/location/by-ip` | 30/min |

Exceeding a limit returns HTTP 429 with `Retry-After`. If Open-Meteo starts
returning 429s, a circuit breaker opens after a few consecutive failures and
serves stale cached data (`degraded: true`) instead of erroring — see
[`backend/README.md`](backend/README.md#behavior-notes) for the full list.

