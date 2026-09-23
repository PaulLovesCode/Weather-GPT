"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Navigation, Sparkles, CloudSun, MapPin } from "lucide-react";
import { WeatherUnit } from "../types/weather";

interface WeatherHeaderProps {
  city: string;
  setCity: (city: string) => void;
  onSearch: (cityToSearch?: string) => void;
  onLocate: () => void;
  unit: WeatherUnit;
  onSetUnit: (unit: WeatherUnit) => void;
  onOpenChat: () => void;
  loading: boolean;
  locationLoading: boolean;
}

const PRESET_CITIES = ["New York", "London", "Tokyo", "Paris", "Sydney", "Dubai"];

export function WeatherHeader({
  city,
  setCity,
  onSearch,
  onLocate,
  unit,
  onSetUnit,
  onOpenChat,
  loading,
  locationLoading,
}: WeatherHeaderProps) {
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (city.trim()) {
      onSearch(city);
    }
  };

  const handlePresetClick = (preset: string) => {
    setCity(preset);
    onSearch(preset);
  };

  return (
    <header className="relative z-20 w-full max-w-6xl mx-auto pt-6 px-4 pb-4">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Brand Logo */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => onSearch("London")}
        >
          <div className="relative p-2.5 rounded-2xl bg-gradient-to-br from-sky-400/20 to-blue-600/30 border border-sky-400/30 shadow-lg shadow-sky-500/10 group-hover:scale-105 transition-transform duration-300">
            <CloudSun className="w-7 h-7 text-sky-400 animate-float-gentle" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white font-sans">
                Atmosphere<span className="text-sky-400">AI</span>
              </h1>
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
                Live
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Real-time Weather & Climate Intelligence
            </p>
          </div>
        </motion.div>

        {/* Search Bar & Location Actions */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-1 max-w-lg w-full"
        >
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <div
              className={`relative w-full flex items-center rounded-2xl glass-input px-4 py-2.5 transition-all duration-300 ${
                isSearchFocused ? "border-sky-400/60 shadow-lg shadow-sky-500/10" : ""
              }`}
            >
              <Search className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
              <input
                type="text"
                aria-label="Search city, country or location"
                placeholder="Search city, country or location..."
                value={city}
                onChange={(e) => setCity(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-400 focus:outline-none font-medium"
              />
              <button
                type="submit"
                disabled={loading || !city.trim()}
                className="ml-2 px-3 py-1 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-sky-300 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {loading ? "Searching..." : "Search"}
              </button>
            </div>
          </form>
        </motion.div>

        {/* Action Controls: Location Button, Unit Switcher & WeatherGPT Trigger */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2.5 shrink-0"
        >
          {/* Current Location button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onLocate}
            disabled={locationLoading}
            aria-label="Use current location"
            title="Use current geolocation"
            className="p-2.5 rounded-2xl glass-panel-interactive text-slate-300 hover:text-sky-400 relative group flex items-center gap-1.5 px-3 text-xs font-medium"
          >
            <Navigation
              className={`w-4 h-4 ${
                locationLoading ? "animate-spin text-sky-400" : "text-sky-400"
              }`}
            />
            <span className="hidden sm:inline">My Location</span>
          </motion.button>

          {/* C / F Unit Switcher with targeted setters */}
          <div className="p-1 rounded-2xl glass-panel flex items-center gap-1">
            <button
              onClick={() => onSetUnit("C")}
              aria-label="Select Celsius"
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                unit === "C"
                  ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              °C
            </button>
            <button
              onClick={() => onSetUnit("F")}
              aria-label="Select Fahrenheit"
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                unit === "F"
                  ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              °F
            </button>
          </div>

          {/* AI Assistant Chat Drawer Trigger */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onOpenChat}
            className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-xs font-semibold shadow-lg shadow-sky-500/25 border border-sky-400/30 flex items-center gap-2 transition-all hover:shadow-sky-500/40"
          >
            <Sparkles className="w-4 h-4 text-sky-200 animate-pulse" />
            <span>WeatherGPT</span>
          </motion.button>
        </motion.div>
      </div>

      {/* Preset Cities Chips */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-2 mt-4 overflow-x-auto pb-1 no-scrollbar text-xs"
      >
        <span className="text-slate-400 font-medium flex items-center gap-1 shrink-0 mr-1">
          <MapPin className="w-3.5 h-3.5 text-sky-400" /> Popular:
        </span>
        {PRESET_CITIES.map((cityName) => (
          <button
            key={cityName}
            onClick={() => handlePresetClick(cityName)}
            className="px-3 py-1.5 rounded-xl glass-panel-interactive text-slate-300 hover:text-sky-300 text-xs font-medium shrink-0"
          >
            {cityName}
          </button>
        ))}
      </motion.div>
    </header>
  );
}
