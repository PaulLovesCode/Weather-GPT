"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { WeatherBackground } from "./components/WeatherBackground";
import { WeatherHeader } from "./components/WeatherHeader";
import { CurrentWeatherCard } from "./components/CurrentWeatherCard";
import { WeatherMetricsGrid } from "./components/WeatherMetricsGrid";
import { ForecastSection } from "./components/ForecastSection";
import { WeatherGPTDrawer } from "./components/WeatherGPTDrawer";
import dynamic from "next/dynamic";

const WeatherMapModal = dynamic(
  () => import("./components/WeatherMapModal").then((m) => m.WeatherMapModal),
  { ssr: false }
);
import { WeatherSkeleton } from "./components/WeatherSkeleton";
import {
  WeatherData,
  ForecastDay,
  HourlyPoint,
  ForecastResponse,
  ChatMessage,
  WeatherUnit,
} from "./types/weather";
import {
  fetchCurrentAndForecastByCity,
  fetchCurrentAndForecastByCoords,
  postChatMessage,
} from "./utils/api";

const WEATHER_CACHE_KEY = "atmosphere_weather_cache";
const COORDS_CACHE_KEY = "atmosphere_coords_cache";
const CACHE_TTL = 15 * 60 * 1000;

interface CachedWeather {
  ts: number;
  data: { weather: WeatherData; forecast: ForecastResponse };
}

interface CachedCoords {
  lat: number;
  lon: number;
  ts: number;
}

function readWeatherCache(): CachedWeather | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedWeather;
    return Date.now() - cached.ts < CACHE_TTL ? cached : null;
  } catch {
    return null;
  }
}

function writeWeatherCache(data: {
  weather: WeatherData;
  forecast: ForecastResponse;
}) {
  try {
    localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {
    // Ignore cache write error
  }
}

function readCoordsCache(): CachedCoords | null {
  try {
    const raw = localStorage.getItem(COORDS_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedCoords;
    return Date.now() - cached.ts < CACHE_TTL ? cached : null;
  } catch {
    return null;
  }
}

function writeCoordsCache(lat: number, lon: number) {
  try {
    localStorage.setItem(
      COORDS_CACHE_KEY,
      JSON.stringify({ lat, lon, ts: Date.now() })
    );
  } catch {
    // Ignore cache write error
  }
}

export default function Home() {
  const [city, setCity] = useState("");
  const [unit, setUnit] = useState<WeatherUnit>(() => {
    try {
      const stored = localStorage.getItem("atmosphere_unit");
      return stored === "C" || stored === "F" ? stored : "C";
    } catch {
      return "C";
    }
  });
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [hourly, setHourly] = useState<HourlyPoint[]>([]);
  const [error, setError] = useState("");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [previousLocation, setPreviousLocation] = useState<string | null>(null);

  const activeAbortController = useRef<AbortController | null>(null);

  // Restore cached weather instantly on mount (stale-while-revalidate)
  useEffect(() => {
    const cached = readWeatherCache();
    if (cached && cached.data.weather) {
      // Reading from localStorage and feeding the store on mount is the
      // sanctioned external-system sync; covered intentionally.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWeather(cached.data.weather);
      setForecast(cached.data.forecast.forecast || []);
      setHourly(cached.data.forecast.hourly || []);
      if (cached.data.weather.location?.name) {
        setPreviousLocation(cached.data.weather.location.name);
      }
      setLoading(false);
    }

    getCurrentLocation();
  }, []);

  const handleSetUnit = (newUnit: WeatherUnit) => {
    setUnit(newUnit);
    try {
      localStorage.setItem("atmosphere_unit", newUnit);
    } catch {
      // Ignore localStorage write error
    }
  };

  function getCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationLoading(false);
      searchWeather("London");
      return;
    }

    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }
    const controller = new AbortController();
    activeAbortController.current = controller;

    setLocationLoading(true);

    const applyCoords = async (latitude: number, longitude: number) => {
      try {
        const { weather: wData, forecast: fData } =
          await fetchCurrentAndForecastByCoords(
            latitude,
            longitude,
            controller.signal
          );

        writeCoordsCache(latitude, longitude);
        writeWeatherCache({ weather: wData, forecast: fData });

        setWeather(wData);
        setForecast(fData.forecast || []);
        setHourly(fData.hourly || []);

        if (wData.location?.name) {
          setPreviousLocation(wData.location.name);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("Coordinate fetch error:", err);
        searchWeather("London");
      } finally {
        setLoading(false);
        setLocationLoading(false);
      }
    };
    const cachedCoords = readCoordsCache();
    if (cachedCoords) {
      setLoading(false);
      applyCoords(cachedCoords.lat, cachedCoords.lon);
    } else {
      setLoading(true);
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        writeCoordsCache(latitude, longitude);
        applyCoords(latitude, longitude);
      },
      (geoError) => {
        console.error("Geolocation error:", geoError);
        if (!cachedCoords) {
          setLoading(false);
          setLocationLoading(false);
          searchWeather("London");
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 4000,
        maximumAge: 300000,
      }
    );
  }

  async function loadWeatherByCoords(latitude: number, longitude: number) {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }
    const controller = new AbortController();
    activeAbortController.current = controller;

    setLoading(true);
    setError("");

    try {
      const { weather: wData, forecast: fData } =
        await fetchCurrentAndForecastByCoords(
          latitude,
          longitude,
          controller.signal
        );

      writeCoordsCache(latitude, longitude);
      writeWeatherCache({ weather: wData, forecast: fData });

      setWeather(wData);
      setForecast(fData.forecast || []);
      setHourly(fData.hourly || []);

      if (wData.location?.name) {
        setPreviousLocation(wData.location.name);
        setCity(wData.location.name);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Map coordinate fetch error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to AtmosphereAI backend."
      );
    } finally {
      setLoading(false);
    }
  }

  async function searchWeather(targetCity?: string) {
    const cityToSearch = (targetCity || city).trim();
    if (!cityToSearch) return;

    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }
    const controller = new AbortController();
    activeAbortController.current = controller;

    setLoading(true);
    setError("");

    try {
      const { weather: wData, forecast: fData } =
        await fetchCurrentAndForecastByCity(cityToSearch, controller.signal);

      writeWeatherCache({ weather: wData, forecast: fData });

      setWeather(wData);
      setForecast(fData.forecast || []);
      setHourly(fData.hourly || []);

      if (wData.location?.name) {
        setPreviousLocation(wData.location.name);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("City search error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to AtmosphereAI backend."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSendChatMessage(userMessage: string) {
    if (!userMessage.trim() || chatLoading) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: "user",
      content: userMessage,
    };

    setChatLoading(true);
    setChatMessages((prev) => [...prev, userMsg]);

    try {
      const data = await postChatMessage(userMessage, previousLocation);

      if (data.reply) {
        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: "assistant",
          content: data.reply,
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
      }

      if (data.location?.name) {
        setPreviousLocation(data.location.name);
      }
    } catch (err) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "assistant",
        content: "Sorry, I encountered an issue reaching the WeatherGPT server.",
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen text-slate-100 font-sans selection:bg-sky-500/30 selection:text-sky-200">
      {/* Condition Canvas Weather Background */}
      <WeatherBackground condition={weather?.weather.condition || "Clear"} />

      {/* Header Bar */}
      <WeatherHeader
        city={city}
        setCity={setCity}
        onSearch={searchWeather}
        onLocate={getCurrentLocation}
        unit={unit}
        onSetUnit={handleSetUnit}
        onOpenChat={() => setIsChatOpen(true)}
        onOpenMap={() => setIsMapOpen(true)}
        loading={loading}
        locationLoading={locationLoading}
      />

      {/* Main Container */}
      <main className="relative z-10 w-full max-w-6xl mx-auto px-4 pb-16 pt-2 space-y-6">
        {/* Error Notification Alert */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => searchWeather(city || "London")}
                className="px-3 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 font-bold transition-colors"
              >
                Retry
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading Skeleton */}
        {loading && !weather && <WeatherSkeleton />}

        {/* Weather Content Layout */}
        {weather && (
          <div className="space-y-6">
            {/* Top Row: Hero Current Weather Card */}
            <CurrentWeatherCard
              weather={weather}
              unit={unit}
              minTemp={forecast[0]?.temperature_min}
              maxTemp={forecast[0]?.temperature_max}
            />

            {/* Middle Row: Tactical Weather Metrics Grid */}
            <WeatherMetricsGrid weather={weather.weather} unit={unit} />

            {/* Bottom Row: Forecast Section (Daily & Hourly) */}
            {forecast.length > 0 && (
              <ForecastSection
                forecast={forecast}
                hourly={hourly}
                unit={unit}
              />
            )}
          </div>
        )}
      </main>

      {/* WeatherGPT Assistant Drawer */}
      <WeatherGPTDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        onSendMessage={handleSendChatMessage}
        loading={chatLoading}
        currentLocation={previousLocation}
      />

      {/* Interactive Weather Map */}
      <AnimatePresence>
        {isMapOpen && (
          <WeatherMapModal
            unit={unit}
            initialCoords={
              weather?.location?.latitude && weather?.location?.longitude
                ? {
                    lat: weather.location.latitude,
                    lon: weather.location.longitude,
                  }
                : undefined
            }
            onClose={() => setIsMapOpen(false)}
            onSelectLocation={loadWeatherByCoords}
          />
        )}
      </AnimatePresence>
    </div>
  );
}