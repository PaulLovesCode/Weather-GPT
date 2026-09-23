"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { SamsungWeatherIllustration } from "./SamsungWeatherIllustration";
import { Droplets, Wind, Thermometer, MapPin } from "lucide-react";
import { WeatherData, WeatherUnit } from "../types/weather";
import { convertTemp, convertWindSpeed } from "../utils/weather";

interface CurrentWeatherCardProps {
  weather: WeatherData;
  unit: WeatherUnit;
  minTemp?: number;
  maxTemp?: number;
}

export function CurrentWeatherCard({
  weather,
  unit,
  minTemp,
  maxTemp,
}: CurrentWeatherCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTemp = convertTemp(weather.weather.temperature, unit);
  const feelsLike = convertTemp(weather.weather.feels_like, unit);
  const displayMin = minTemp !== undefined ? convertTemp(minTemp, unit) : null;
  const displayMax = maxTemp !== undefined ? convertTemp(maxTemp, unit) : null;
  const windInfo = convertWindSpeed(weather.weather.wind_speed, unit);

  const formattedDate = mounted
    ? new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-3xl glass-panel p-6 md:p-8 w-full"
    >
      {/* Background glow circle */}
      <div className="absolute -right-12 -top-12 w-64 h-64 bg-sky-500/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        {/* Left Column: Location & Main Temp */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <MapPin className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                  {weather.location.name}
                </h2>
                {weather.location.country && (
                  <span className="text-sm font-semibold text-slate-400">
                    {weather.location.country}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-medium min-h-[16px]">
                {formattedDate}
              </p>
            </div>
          </div>

          {/* Main Temperature Number */}
          <div className="flex items-baseline gap-3 pt-2">
            <motion.span
              key={`${currentTemp}-${unit}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-6xl md:text-7xl font-extrabold text-white tracking-tight"
            >
              {currentTemp}°
            </motion.span>
            <div className="space-y-1">
              <span className="text-xl font-bold text-sky-400 font-sans">
                {unit}
              </span>
              <p className="text-xs text-slate-300 font-medium flex items-center gap-1">
                <Thermometer className="w-3.5 h-3.5 text-sky-400" /> Feels like{" "}
                {feelsLike}°
              </p>
            </div>
          </div>

          {/* High / Low pills */}
          <div className="flex items-center gap-3 pt-1">
            {displayMax !== null && displayMin !== null && (
              <>
                <span className="px-3 py-1 rounded-xl bg-slate-800/80 border border-slate-700/50 text-xs font-semibold text-slate-300">
                  H: <span className="text-amber-400 font-bold">{displayMax}°</span>
                </span>
                <span className="px-3 py-1 rounded-xl bg-slate-800/80 border border-slate-700/50 text-xs font-semibold text-slate-300">
                  L: <span className="text-sky-300 font-bold">{displayMin}°</span>
                </span>
              </>
            )}
            <span className="px-3 py-1 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs font-medium text-sky-300">
              {weather.weather.condition}
            </span>
          </div>
        </div>

        {/* Right Column: Samsung Weather Style Graphic & Quick Stats */}
        <div className="flex flex-col items-center md:items-end justify-between gap-4">
          <motion.div
            initial={{ scale: 0.85, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 180, damping: 14 }}
            className="relative p-2 rounded-3xl bg-slate-900/40 border border-slate-700/30 shadow-2xl flex items-center justify-center overflow-hidden"
          >
            <SamsungWeatherIllustration
              condition={weather.weather.condition}
              className="w-44 h-44 md:w-52 md:h-52"
            />
          </motion.div>

          <div className="flex items-center gap-4 text-xs text-slate-300 font-medium bg-slate-900/40 px-4 py-2.5 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-sky-400" />
              <span>{weather.weather.humidity}% Humidity</span>
            </div>
            <div className="h-3 w-[1px] bg-slate-700" />
            <div className="flex items-center gap-1.5">
              <Wind className="w-4 h-4 text-sky-400" />
              <span>
                {windInfo.value} {windInfo.label}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
