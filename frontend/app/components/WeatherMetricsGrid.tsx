"use client";

import { motion } from "framer-motion";
import {
  Wind,
  Droplets,
  CloudRain,
  Compass,
  Thermometer,
  ShieldCheck,
} from "lucide-react";
import { WeatherMetrics, WeatherUnit } from "../types/weather";
import {
  convertTemp,
  convertWindSpeed,
  getBeaufortScale,
} from "../utils/weather";

interface WeatherMetricsGridProps {
  weather: WeatherMetrics;
  unit: WeatherUnit;
}

export function WeatherMetricsGrid({ weather, unit }: WeatherMetricsGridProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
  };

  // Unit-aware temperatures
  const currentTemp = convertTemp(weather.temperature, unit);
  const feelsLikeTemp = convertTemp(weather.feels_like, unit);
  const tempDiff = Math.abs(currentTemp - feelsLikeTemp);

  const feelsMessage =
    feelsLikeTemp > currentTemp
      ? "Warmer due to humidity"
      : feelsLikeTemp < currentTemp
      ? "Colder due to wind chill"
      : "Matches actual temperature";

  // Real wind speed and Beaufort scale
  const windInfo = convertWindSpeed(weather.wind_speed, unit);
  const beaufort = getBeaufortScale(weather.wind_speed);
  const windDirectionDeg = weather.wind_direction ?? 0;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full"
    >
      {/* 1. Wind Speed & Direction Compass Card */}
      <motion.div
        variants={itemVariants}
        whileHover={{ y: -4 }}
        className="glass-panel-interactive rounded-2xl p-5 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <Wind className="w-4 h-4 text-sky-400" /> Wind
          </span>
          <Compass className="w-4 h-4 text-slate-500" />
        </div>

        <div className="my-3 flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {windInfo.value}{" "}
              <span className="text-xs font-normal text-slate-400">
                {windInfo.label}
              </span>
            </div>
            <p className="text-xs text-sky-300 font-medium mt-0.5">
              {beaufort.label} ({windDirectionDeg}°)
            </p>
          </div>
          {/* Compass visual indicator driven by real wind direction */}
          <div
            className="relative w-11 h-11 rounded-full border border-slate-700 bg-slate-900/60 flex items-center justify-center"
            title={`Wind direction: ${windDirectionDeg}°`}
          >
            <div className="absolute text-[9px] font-bold text-slate-400 top-0.5">
              N
            </div>
            <div
              className="w-1 h-6 bg-gradient-to-t from-transparent via-sky-400 to-sky-400 rounded-full transition-transform duration-700"
              style={{ transform: `rotate(${windDirectionDeg}deg)` }}
            />
          </div>
        </div>

        <div className="w-full bg-slate-800/60 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-sky-400 h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, (weather.wind_speed / 60) * 100)}%` }}
          />
        </div>
      </motion.div>

      {/* 2. Humidity Meter Card */}
      <motion.div
        variants={itemVariants}
        whileHover={{ y: -4 }}
        className="glass-panel-interactive rounded-2xl p-5 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <Droplets className="w-4 h-4 text-blue-400" /> Humidity
          </span>
          <span className="text-slate-400 text-xs">{weather.humidity}%</span>
        </div>

        <div className="my-3">
          <div className="text-2xl font-bold text-white tracking-tight">
            {weather.humidity}%
          </div>
          <p className="text-xs text-slate-300 font-medium mt-0.5">
            {weather.humidity > 70
              ? "High moisture levels"
              : weather.humidity < 30
              ? "Dry atmosphere"
              : "Comfortable relative humidity"}
          </p>
        </div>

        <div className="w-full bg-slate-800/60 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-400 to-sky-300 h-full rounded-full transition-all duration-500"
            style={{ width: `${weather.humidity}%` }}
          />
        </div>
      </motion.div>

      {/* 3. Precipitation Card */}
      <motion.div
        variants={itemVariants}
        whileHover={{ y: -4 }}
        className="glass-panel-interactive rounded-2xl p-5 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <CloudRain className="w-4 h-4 text-cyan-400" /> Rain Volume
          </span>
        </div>

        <div className="my-3">
          <div className="text-2xl font-bold text-white tracking-tight">
            {weather.precipitation}{" "}
            <span className="text-xs font-normal text-slate-400">mm</span>
          </div>
          <p className="text-xs text-slate-300 font-medium mt-0.5">
            {weather.precipitation > 5
              ? "Heavy rain accumulation"
              : weather.precipitation > 0
              ? "Light precipitation"
              : "No rainfall expected"}
          </p>
        </div>

        <div className="w-full bg-slate-800/60 h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-cyan-400 h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, (weather.precipitation / 10) * 100)}%` }}
          />
        </div>
      </motion.div>

      {/* 4. Feels Like Thermal Gauge Card */}
      <motion.div
        variants={itemVariants}
        whileHover={{ y: -4 }}
        className="glass-panel-interactive rounded-2xl p-5 flex flex-col justify-between"
      >
        <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <Thermometer className="w-4 h-4 text-amber-400" /> RealFeel
          </span>
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
        </div>

        <div className="my-3">
          <div className="text-2xl font-bold text-white tracking-tight">
            {feelsLikeTemp}°{unit}
          </div>
          <p className="text-xs text-amber-300/90 font-medium mt-0.5">
            {feelsMessage}
          </p>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
          <span>Actual: {currentTemp}°</span>
          <span>Diff: {tempDiff}°</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
