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
import { WeatherSkeleton } from "./components/WeatherSkeleton";
import {
  WeatherData,
  ForecastDay,
  HourlyPoint,
  ChatMessage,
  WeatherUnit,
} from "./types/weather";
import {
  fetchCurrentAndForecastByCity,
  fetchCurrentAndForecastByCoords,
  postChatMessage,
} from "./utils/api";

export default function Home() {
  const [city, setCity] = useState("");
  const [unit, setUnit] = useState<WeatherUnit>("C");
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [hourly, setHourly] = useState<HourlyPoint[]>([]);
  const [error, setError] = useState("");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [previousLocation, setPreviousLocation] = useState<string | null>(null);

  const activeAbortController = useRef<AbortController | null>(null);

  // Restore unit preference from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("atmosphere_unit");
      if (stored === "C" || stored === "F") {
        setUnit(stored);
      }
    } catch {
      // LocalStorage access may be restricted
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
    setLoading(true);
    setError("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const { weather: wData, forecast: fData } =
            await fetchCurrentAndForecastByCoords(
              latitude,
              longitude,
              controller.signal
            );

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
      },
      (geoError) => {
        console.error("Geolocation error:", geoError);
        setLoading(false);
        setLocationLoading(false);
        searchWeather("London");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
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
    </div>
  );
}