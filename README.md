# AtmosphereAI / WeatherGPT 🌤️🤖

AtmosphereAI (WeatherGPT) is an AI-powered, full-stack weather intelligence platform. It pairs live atmospheric telemetry and multi-day forecasting with a conversational AI assistant capable of answering natural-language weather queries.

---

## 🌟 Features

- **Live Atmospheric Telemetry**: Real-time temperature, humidity, wind direction & speed (with Beaufort scale), visibility, UV index, air pressure, and "Feels Like" thermal index.
- **24-Hour & 7-Day Forecasting**: High-precision hourly temperature & precipitation curves along with 7-day temperature range predictions.
- **Dynamic Weather Canvas**: High-DPI particle engine simulating rain, snow, mist, thunderstorm lightning, and sunny ambiance with automatic night-mode transitions and `prefers-reduced-motion` support.
- **WeatherGPT AI Assistant**: Integrated natural language drawer powered by Google Gemini (`gemini-3.6-flash`, `gemini-2.5-flash`) and OpenRouter fallback for real-time weather Q&A.
- **Global Search & Geolocation**: Instant coordinate detection via browser geolocation with worldwide city search and reverse geocoding.
- **Unit Customization**: Persistent Celsius ($^\circ\text{C}$) and Fahrenheit ($^\circ\text{F}$) unit switching via `localStorage`.

---

## 🏗️ Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Framer Motion, Lucide Icons, Canvas Confetti
- **Backend**: Python 3.10+, FastAPI, Uvicorn, HTTPX, Pydantic, Google GenAI SDK, OpenAI SDK (OpenRouter integration)
- **Weather Data**: Open-Meteo Weather APIs & OpenStreetMap Geocoding

---

## 📋 Prerequisites

Before running the project, make sure you have installed:
- **Node.js**: v18.18.0 or higher
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
   Create a `.env` file in the `backend/` directory:
   ```env
   # Google Gemini API key (recommended)
   GEMINI_API_KEY=your_gemini_api_key_here

   # OpenRouter API key (optional fallback)
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   ```

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

---

## 📁 Project Structure

```text
Weather2/
├── README.md               # Root documentation
├── .gitignore
│
├── backend/                # FastAPI Backend
│   ├── main.py             # FastAPI entrypoint and REST endpoints
│   ├── weather.py          # Open-Meteo weather integration & mapping
│   ├── geocoding.py        # Location search and coordinate mapping
│   ├── intent.py           # Natural language query parsing
│   ├── llm.py              # LLM routing layer (Gemini / OpenRouter)
│   ├── gemini_utils.py     # Google GenAI client implementation
│   ├── openrouter_utils.py # OpenRouter client with retry logic
│   ├── requirements.txt    # Python dependencies
│   └── .env                # Backend environment secrets
│
└── frontend/               # Next.js 16 Frontend
    ├── app/
    │   ├── components/     # UI Components (Cards, Gauges, Canvas, Drawer)
    │   ├── types/          # TypeScript interfaces for weather & chat data
    │   ├── utils/          # API callers and formatters
    │   ├── globals.css     # Global styles & Tailwind CSS v4 setup
    │   ├── layout.tsx      # Root layout
    │   └── page.tsx        # Main dashboard page
    ├── package.json        # Frontend dependencies and scripts
    └── .env.local          # Frontend environment variables
```

---

## 🔌 API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | API status check |
| `GET` | `/api/health` | Healthcheck endpoint |
| `GET` | `/api/weather?city={city}` | Get current weather telemetry for a city |
| `GET` | `/api/forecast?city={city}` | Get 7-day & hourly forecast for a city |
| `GET` | `/api/weather/current?lat={lat}&lon={lon}` | Get current weather telemetry by coordinates |
| `GET` | `/api/forecast/current?lat={lat}&lon={lon}` | Get forecast by coordinates |
| `POST` | `/api/chat` | Send conversational prompt to WeatherGPT AI |

