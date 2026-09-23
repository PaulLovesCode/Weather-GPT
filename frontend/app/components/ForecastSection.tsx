"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Clock, CloudRain, Wind, ChevronRight, Sparkles } from "lucide-react";
import { ForecastDay, HourlyPoint, WeatherUnit } from "../types/weather";
import { convertTemp, getWeatherIconComponent } from "../utils/weather";

interface ForecastSectionProps {
  forecast: ForecastDay[];
  hourly?: HourlyPoint[];
  unit: WeatherUnit;
}

export function ForecastSection({
  forecast,
  hourly = [],
  unit,
}: ForecastSectionProps) {
  const [activeTab, setActiveTab] = useState<"daily" | "hourly">("daily");
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(0);

  // Calculate total min/max for relative temperature bar range rendering
  const globalMin = forecast.length
    ? Math.min(...forecast.map((f) => f.temperature_min), 0)
    : 0;
  const globalMax = forecast.length
    ? Math.max(...forecast.map((f) => f.temperature_max), 35)
    : 35;
  const range = Math.max(1, globalMax - globalMin);

  return (
    <div className="w-full space-y-4">
      {/* Tab Controls Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 p-1 rounded-2xl glass-panel">
          <button
            onClick={() => setActiveTab("daily")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "daily"
                ? "bg-sky-500 text-white shadow-md shadow-sky-500/25"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" /> 7-Day Forecast
          </button>
          <button
            onClick={() => setActiveTab("hourly")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === "hourly"
                ? "bg-sky-500 text-white shadow-md shadow-sky-500/25"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Clock className="w-3.5 h-3.5" /> Hourly Breakdown
          </button>
        </div>

        <span className="text-xs text-slate-400 font-medium hidden sm:inline-flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-sky-400" /> Dynamic climate telemetry
        </span>
      </div>

      {/* Tab Body */}
      <AnimatePresence mode="wait">
        {activeTab === "daily" ? (
          <motion.div
            key="daily"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 gap-2.5"
          >
            {forecast.map((day, idx) => {
              const dayDate = new Date(day.date);
              const dayName =
                idx === 0
                  ? "Today"
                  : dayDate.toLocaleDateString("en-US", { weekday: "short" });
              const dateFormatted = dayDate.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });

              const isSelected = selectedDayIndex === idx;

              const minTempConverted = convertTemp(day.temperature_min, unit);
              const maxTempConverted = convertTemp(day.temperature_max, unit);

              const leftPercent = ((day.temperature_min - globalMin) / range) * 100;
              const widthPercent =
                ((day.temperature_max - day.temperature_min) / range) * 100;

              return (
                <motion.div
                  key={day.date}
                  whileHover={{ scale: 1.01, x: 2 }}
                  onClick={() => setSelectedDayIndex(isSelected ? null : idx)}
                  className={`rounded-2xl p-4 cursor-pointer transition-all duration-300 ${
                    isSelected
                      ? "bg-slate-800/90 border border-sky-500/40 shadow-lg shadow-sky-500/10"
                      : "glass-panel-interactive"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    {/* Day & Icon */}
                    <div className="flex items-center gap-3 w-36 shrink-0">
                      <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-700/50">
                        {getWeatherIconComponent(day.condition, "w-6 h-6")}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{dayName}</div>
                        <div className="text-[11px] text-slate-400 font-medium">
                          {dateFormatted}
                        </div>
                      </div>
                    </div>

                    {/* Rain Probability Badge */}
                    <div className="flex items-center gap-1 text-xs text-sky-400 font-semibold w-24 shrink-0">
                      <CloudRain className="w-3.5 h-3.5" />
                      <span>{day.rain_probability}%</span>
                    </div>

                    {/* Temperature Slider Range Bar */}
                    <div className="flex-1 hidden md:flex items-center gap-3">
                      <span className="text-xs font-semibold text-slate-400 w-8 text-right">
                        {minTempConverted}°
                      </span>
                      <div className="relative flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="absolute h-full bg-gradient-to-r from-sky-400 via-blue-500 to-amber-400 rounded-full"
                          style={{
                            left: `${Math.max(0, leftPercent)}%`,
                            width: `${Math.max(10, widthPercent)}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs font-bold text-white w-8">
                        {maxTempConverted}°
                      </span>
                    </div>

                    {/* Mobile Temp range view */}
                    <div className="md:hidden text-right text-xs font-bold">
                      <span className="text-white">{maxTempConverted}°</span>
                      <span className="text-slate-400 ml-1">/ {minTempConverted}°</span>
                    </div>

                    <ChevronRight
                      className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${
                        isSelected ? "rotate-90 text-sky-400" : ""
                      }`}
                    />
                  </div>

                  {/* Expanded detail panel */}
                  {isSelected && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-3 pt-3 border-t border-slate-700/50 grid grid-cols-3 gap-2 text-xs"
                    >
                      <div className="p-2.5 rounded-xl bg-slate-900/50">
                        <span className="text-slate-400 block text-[10px]">Condition</span>
                        <span className="font-semibold text-sky-300">{day.condition}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900/50">
                        <span className="text-slate-400 block text-[10px]">Max Wind</span>
                        <span className="font-semibold text-slate-200 flex items-center gap-1">
                          <Wind className="w-3 h-3 text-sky-400" /> {day.wind_speed_max} km/h
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900/50">
                        <span className="text-slate-400 block text-[10px]">Rainfall</span>
                        <span className="font-semibold text-cyan-300">
                          {day.precipitation} mm
                        </span>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          /* Real Hourly Timeline */
          <motion.div
            key="hourly"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-3 overflow-x-auto pb-3 pt-1 no-scrollbar"
          >
            {hourly.length > 0 ? (
              hourly.map((item, index) => (
                <motion.div
                  key={(item.raw_time || item.time) + index}
                  whileHover={{ y: -6, scale: 1.04 }}
                  className="glass-panel-interactive rounded-2xl p-4 flex flex-col items-center justify-between min-w-[105px] h-40 space-y-2 shrink-0 text-center"
                >
                  <span className="text-xs font-semibold text-slate-400">{item.time}</span>
                  <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-700/50">
                    {getWeatherIconComponent(item.condition, "w-6 h-6")}
                  </div>
                  <div className="text-lg font-bold text-white">
                    {convertTemp(item.temperature, unit)}°
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-sky-400">
                    <CloudRain className="w-3 h-3" />
                    <span>{item.rain_probability}%</span>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="w-full text-center py-8 text-xs text-slate-400">
                Hourly telemetry is loading or unavailable.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
