"use client";

import { useState } from "react";

type WeatherData = {
  location: {
    name: string;
    admin1?: string;
    country?: string;
  };
  weather: {
    temperature: number;
    feels_like: number;
    humidity: number;
    wind_speed: number;
    precipitation: number;
    condition: string;
  };
};

type ForecastDay = {
  date: string;
  temperature_max: number;
  temperature_min: number;
  precipitation: number;
  rain_probability: number;
  wind_speed_max: number;
  condition: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function getWeatherIcon(condition: string) {
  const value = condition.toLowerCase();

  if (
    value.includes("rain") ||
    value.includes("drizzle") ||
    value.includes("shower")
  ) {
    return "🌧️";
  }

  if (
    value.includes("storm") ||
    value.includes("thunder")
  ) {
    return "⛈️";
  }

  if (
    value.includes("cloud") ||
    value.includes("overcast")
  ) {
    return "☁️";
  }

  if (
    value.includes("snow") ||
    value.includes("ice")
  ) {
    return "❄️";
  }

  if (
    value.includes("clear") ||
    value.includes("sunny")
  ) {
    return "☀️";
  }

  if (
    value.includes("fog") ||
    value.includes("mist")
  ) {
    return "🌫️";
  }

  return "🌤️";
}

export default function Home() {
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);

  const [weather, setWeather] =
    useState<WeatherData | null>(null);

  const [forecast, setForecast] =
    useState<ForecastDay[]>([]);

  const [error, setError] = useState("");

  const [chatMessage, setChatMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>([]);

  const [previousLocation, setPreviousLocation] =
    useState<string | null>(null);

  async function searchWeather() {
    if (!city.trim()) return;

    setLoading(true);
    setError("");
    setWeather(null);
    setForecast([]);

    try {
      const weatherResponse = await fetch(
        `http://localhost:8000/api/weather?city=${encodeURIComponent(
          city
        )}`
      );

      const weatherData = await weatherResponse.json();

      if (weatherData.error) {
        setError(weatherData.error);
        return;
      }

      const forecastResponse = await fetch(
        `http://localhost:8000/api/forecast?city=${encodeURIComponent(
          city
        )}`
      );

      const forecastData =
        await forecastResponse.json();

      if (forecastData.error) {
        setError(forecastData.error);
        return;
      }

      setWeather(weatherData);
      setForecast(forecastData.forecast);

      setPreviousLocation(
        weatherData.location.name
      );
    } catch (error) {
      console.error(error);
      setError(
        "Could not connect to WeatherGPT backend."
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendChatMessage() {
    if (!chatMessage.trim() || chatLoading) return;

    const userMessage = chatMessage.trim();

    setChatMessage("");
    setChatLoading(true);
    setError("");

    setChatMessages((previous) => [
      ...previous,
      {
        role: "user",
        content: userMessage,
      },
    ]);

    try {
      const response = await fetch(
        "http://localhost:8000/api/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: userMessage,
            previous_location:
              previousLocation,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Chat request failed."
        );
      }

      if (data.reply) {
        setChatMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            content: data.reply,
          },
        ]);
      }

      if (data.location?.name) {
        setPreviousLocation(
          data.location.name
        );
      }
    } catch (error) {
      console.error(error);

      setChatMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            "Sorry, I couldn't connect to the WeatherGPT backend.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);

    return date.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  function getGreeting() {
    const hour = new Date().getHours();

    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";

    return "Good evening";
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070d] text-white">
      {/* Atmospheric background */}
      <div className="weather-bg" />

      {/* Main content */}
      <div className="relative z-10 mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-10">

        {/* ================= HEADER ================= */}

        <header className="mb-10 flex items-center justify-between">

          <div className="flex items-center gap-3">

            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-xl shadow-lg">
              ☁️
            </div>

            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                WeatherGPT
              </h1>

              <p className="text-xs text-slate-500">
                Conversational weather intelligence
              </p>
            </div>

          </div>

          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-slate-400 sm:flex">

            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />

            Weather AI online

          </div>

        </header>

        {/* ================= HERO ================= */}

        <section className="mb-8">

          <div className="mb-5">

            <p className="text-sm font-medium text-blue-400">
              {getGreeting()}
            </p>

            <h2 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
              How's the weather?
            </h2>

            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              Search any city or ask WeatherGPT a
              question about the weather.
            </p>

          </div>

          {/* Search */}
          <div className="glass shine flex items-center rounded-2xl p-2 shadow-2xl">

            <div className="flex h-11 w-11 shrink-0 items-center justify-center text-lg">
              📍
            </div>

            <input
              type="text"
              placeholder="Search a city..."
              value={city}
              onChange={(e) =>
                setCity(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  searchWeather();
                }
              }}
              className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white outline-none placeholder:text-slate-600"
            />

            <button
              onClick={searchWeather}
              disabled={loading || !city.trim()}
              className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-all duration-300 hover:scale-[1.02] hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {loading ? "Searching..." : "Search"}
            </button>

          </div>

        </section>

        {/* ================= ERROR ================= */}

        {error && (
          <div className="mb-8 rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* ================= WEATHER ================= */}

        {weather && (
          <div className="animate-[fadeIn_0.5s_ease-out]">

            {/* Current weather */}
            <section className="glass shine relative overflow-hidden rounded-3xl p-6 shadow-2xl sm:p-8">

              <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl" />

              <div className="relative">

                <div className="flex flex-col justify-between gap-8 sm:flex-row">

                  {/* Location */}
                  <div>

                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <span>📍</span>

                      <span>
                        {weather.location.name}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-slate-600">
                      {weather.location.admin1}
                      {weather.location.admin1 &&
                      weather.location.country
                        ? ", "
                        : ""}
                      {weather.location.country}
                    </p>

                    <div className="mt-8 flex items-center gap-5">

                      <div className="float text-6xl">
                        {getWeatherIcon(
                          weather.weather.condition
                        )}
                      </div>

                      <div>

                        <div className="text-6xl font-semibold tracking-tighter sm:text-7xl">
                          {weather.weather.temperature}
                          <span className="text-3xl text-slate-500">
                            °C
                          </span>
                        </div>

                        <p className="mt-1 text-sm text-slate-400">
                          {weather.weather.condition}
                        </p>

                      </div>

                    </div>

                  </div>

                  {/* Feels like */}
                  <div className="sm:text-right">

                    <p className="text-xs uppercase tracking-[0.2em] text-slate-600">
                      Feels like
                    </p>

                    <p className="mt-2 text-2xl font-medium text-slate-200">
                      {weather.weather.feels_like}°C
                    </p>

                  </div>

                </div>

                {/* Stats */}
                <div className="mt-10 grid grid-cols-2 gap-3 border-t border-white/5 pt-6 sm:grid-cols-4">

                  <WeatherStat
                    icon="💧"
                    label="Humidity"
                    value={`${weather.weather.humidity}%`}
                  />

                  <WeatherStat
                    icon="💨"
                    label="Wind"
                    value={`${weather.weather.wind_speed} km/h`}
                  />

                  <WeatherStat
                    icon="🌧️"
                    label="Rain"
                    value={`${weather.weather.precipitation} mm`}
                  />

                  <WeatherStat
                    icon="🌡️"
                    label="Feels like"
                    value={`${weather.weather.feels_like}°C`}
                  />

                </div>

              </div>

            </section>

            {/* ================= FORECAST ================= */}

            {forecast.length > 0 && (
              <section className="mt-10">

                <div className="mb-4 flex items-end justify-between">

                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-600">
                      Outlook
                    </p>

                    <h3 className="mt-1 text-xl font-semibold">
                      7-Day Forecast
                    </h3>
                  </div>

                  <span className="text-xs text-slate-600">
                    Daily
                  </span>

                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

                  {forecast.map((day, index) => (

                    <div
                      key={day.date}
                      className="glass group rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06]"
                      style={{
                        animation:
                          "fadeUp 0.5s ease-out both",
                        animationDelay:
                          `${index * 80}ms`,
                      }}
                    >

                      <div className="flex items-center justify-between">

                        <p className="text-sm font-medium">
                          {formatDate(day.date)}
                        </p>

                        <span className="text-2xl transition-transform duration-300 group-hover:scale-110">
                          {getWeatherIcon(
                            day.condition
                          )}
                        </span>

                      </div>

                      <p className="mt-3 text-xs text-slate-500">
                        {day.condition}
                      </p>

                      <div className="mt-5 flex items-end gap-2">

                        <span className="text-3xl font-semibold">
                          {day.temperature_max}°
                        </span>

                        <span className="mb-1 text-sm text-slate-600">
                          {day.temperature_min}°
                        </span>

                      </div>

                      <div className="mt-5 space-y-2 border-t border-white/5 pt-4 text-xs">

                        <div className="flex justify-between">
                          <span className="text-slate-600">
                            Rain chance
                          </span>

                          <span className="text-slate-300">
                            {day.rain_probability}%
                          </span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-slate-600">
                            Rain
                          </span>

                          <span className="text-slate-300">
                            {day.precipitation} mm
                          </span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-slate-600">
                            Wind
                          </span>

                          <span className="text-slate-300">
                            {day.wind_speed_max} km/h
                          </span>
                        </div>

                      </div>

                    </div>

                  ))}

                </div>

              </section>
            )}

          </div>
        )}

        {/* ================= AI CHAT ================= */}

        <section className="mt-14">

          <div className="mb-5">

            <p className="text-xs uppercase tracking-[0.2em] text-blue-400">
              AI assistant
            </p>

            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              Ask WeatherGPT
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Have a conversation about the weather.
            </p>

          </div>

          <div className="glass overflow-hidden rounded-3xl shadow-2xl">

            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">

              <div className="flex items-center gap-3">

                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10">
                  🤖
                </div>

                <div>
                  <p className="text-sm font-medium">
                    WeatherGPT
                  </p>

                  <p className="text-xs text-slate-600">
                    {previousLocation
                      ? `Context: ${previousLocation}`
                      : "Ready to help"}
                  </p>
                </div>

              </div>

              <div className="flex items-center gap-2 text-xs text-emerald-400">

                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />

                Online

              </div>

            </div>

            {/* Messages */}
            <div className="min-h-[320px] space-y-4 p-5 sm:p-6">

              {chatMessages.length === 0 && (

                <div className="flex min-h-[280px] items-center justify-center">

                  <div className="max-w-sm text-center">

                    <div className="float mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-3xl">
                      🌤️
                    </div>

                    <h3 className="text-lg font-medium">
                      What would you like to know?
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Ask about rain, temperature,
                      wind, tomorrow's weather, or
                      anything weather-related.
                    </p>

                    <div className="mt-5 flex flex-wrap justify-center gap-2">

                      <Suggestion
                        text="Will it rain tomorrow?"
                        onClick={() =>
                          setChatMessage(
                            "Will it rain tomorrow?"
                          )
                        }
                      />

                      <Suggestion
                        text="Is it good for a walk?"
                        onClick={() =>
                          setChatMessage(
                            "Is it good for a walk?"
                          )
                        }
                      />

                    </div>

                  </div>

                </div>

              )}

              {chatMessages.map(
                (message, index) => (

                  <div
                    key={index}
                    className={`flex ${
                      message.role === "user"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                    style={{
                      animation:
                        "fadeUp 0.3s ease-out both",
                    }}
                  >

                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                        message.role === "user"
                          ? "rounded-br-md bg-blue-600 text-white"
                          : "rounded-bl-md bg-white/5 text-slate-300"
                      }`}
                    >

                      {message.role ===
                      "assistant" ? (
                        <FormattedMessage
                          content={
                            message.content
                          }
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}

                    </div>

                  </div>

                )
              )}

              {/* Typing */}
              {chatLoading && (

                <div className="flex justify-start">

                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white/5 px-4 py-4">

                    <span className="dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                    <span className="dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                    <span className="dot h-1.5 w-1.5 rounded-full bg-slate-400" />

                  </div>

                </div>

              )}

            </div>

            {/* Input */}
            <div className="border-t border-white/5 p-4">

              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5 transition-all duration-300 focus-within:border-blue-500/40 focus-within:bg-black/30">

                <input
                  type="text"
                  placeholder="Ask WeatherGPT anything..."
                  value={chatMessage}
                  onChange={(e) =>
                    setChatMessage(
                      e.target.value
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      sendChatMessage();
                    }
                  }}
                  disabled={chatLoading}
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-slate-700 disabled:opacity-50"
                />

                <button
                  onClick={sendChatMessage}
                  disabled={
                    chatLoading ||
                    !chatMessage.trim()
                  }
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-lg text-slate-950 transition-all duration-300 hover:scale-105 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-20"
                  aria-label="Send message"
                >
                  ↑
                </button>

              </div>

              <p className="mt-3 text-center text-[10px] text-slate-700">
                WeatherGPT can make mistakes. Check
                important weather information with
                official sources.
              </p>

            </div>

          </div>

        </section>

        {/* ================= FOOTER ================= */}

        <footer className="py-10 text-center">

          <p className="text-xs text-slate-700">
            WeatherGPT · Conversational weather
            intelligence
          </p>

        </footer>

      </div>

      {/* Animation keyframes */}
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

    </main>
  );
}

/* ================= WEATHER STAT ================= */

function WeatherStat({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="group rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-all duration-300 hover:bg-white/[0.05]">

      <div className="flex items-center gap-2">

        <span className="text-sm">
          {icon}
        </span>

        <span className="text-xs text-slate-600">
          {label}
        </span>

      </div>

      <p className="mt-2 text-lg font-medium text-slate-200">
        {value}
      </p>

    </div>
  );
}

/* ================= SUGGESTION ================= */

function Suggestion({
  text,
  onClick,
}: {
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-500 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.06] hover:text-slate-300"
    >
      {text}
    </button>
  );
}

/* ================= FORMATTED MESSAGE ================= */

function FormattedMessage({
  content,
}: {
  content: string;
}) {
  const parts = content.split("**");

  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong
            key={index}
            className="font-semibold text-white"
          >
            {part}
          </strong>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </p>
  );
}