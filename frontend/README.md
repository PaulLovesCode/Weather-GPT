# AtmosphereAI Frontend

Modern, interactive weather & climate intelligence frontend built with Next.js 16, React 19, Tailwind CSS v4, and Framer Motion.

## Features

- **Live Weather Telemetry**: Real-time conditions, wind compass, humidity gauge, and thermal RealFeel indicators.
- **Real 24-Hour & 7-Day Forecasts**: True hourly telemetry curves with precipitation chance and 7-day temperature range bars.
- **Dynamic Weather Ambiance**: High-DPI Canvas particle simulation (Rain, Snow, Lightning storms, Mist, and Sun flare) with `prefers-reduced-motion` accessibility support.
- **Samsung One UI Styled Illustrations**: Dynamic tactile weather graphics with automatic night mode detection.
- **WeatherGPT AI Drawer**: Natural language climate insights powered by Google Gemini API (`gemini-3.6-flash`), with full ARIA dialog accessibility and keyboard navigation.
- **Unit Persistence**: Seamless °C / °F switching with persistent `localStorage` memory and Beaufort wind scale labels.
- **Resilient Architecture**: Centralized API client, `Promise.all` parallel fetching, `AbortController` cancellation for rapid searches, and React `ErrorBoundary`.

## Environment Variables

Configure `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.
