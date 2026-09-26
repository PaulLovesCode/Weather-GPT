"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Navigation, Sparkles, CloudSun, MapPin, Map, Loader2 } from "lucide-react";
import { LocationData, WeatherUnit } from "../types/weather";
import { fetchLocationSuggestions } from "../utils/api";

interface WeatherHeaderProps {
  city: string;
  setCity: (city: string) => void;
  onSearch: (cityToSearch?: string) => void;
  onSelectLocation: (location: LocationData) => void;
  onLocate: () => void;
  unit: WeatherUnit;
  onSetUnit: (unit: WeatherUnit) => void;
  onOpenChat: () => void;
  onOpenMap: () => void;
  loading: boolean;
  locationLoading: boolean;
}

const PRESET_CITIES = [
  "Delhi",
  "Mumbai",
  "Bengaluru",
  "Kolkata",
  "Chennai",
  "Hyderabad",
];

const MIN_QUERY_LENGTH = 3;
const SUGGESTION_DEBOUNCE_MS = 400;
const LISTBOX_ID = "location-suggestions";

const populationFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "Columbia, Missouri, United States" with empty parts dropped. */
function formatSuggestionLabel(location: LocationData): string {
  return [location.admin1, location.country].filter(Boolean).join(", ");
}

export function WeatherHeader({
  city,
  setCity,
  onSearch,
  onSelectLocation,
  onLocate,
  unit,
  onSetUnit,
  onOpenChat,
  onOpenMap,
  loading,
  locationLoading,
}: WeatherHeaderProps) {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<LocationData[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  // Mirrors `city` so the in-flight request can detect that the user kept typing.
  const cityRef = useRef(city);
  // Set when we write `city` programmatically, so filling the input with a
  // chosen place does not immediately re-open the dropdown for that same name.
  const skipSuggestRef = useRef(false);

  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
    setActiveIndex(0);
  }, []);

  const cancelPendingSuggest = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (suggestAbortRef.current) suggestAbortRef.current.abort();
  }, []);

  useEffect(() => {
    cityRef.current = city;
  }, [city]);

  useEffect(() => {
    const query = city.trim();

    cancelPendingSuggest();
    if (suggestAbortRef.current) suggestAbortRef.current = null;

    if (skipSuggestRef.current) {
      skipSuggestRef.current = false;
      return;
    }

    // Queries shorter than the minimum are reset by `handleCityChange`, so
    // there is deliberately no setState in this effect body.
    if (query.length < MIN_QUERY_LENGTH) return;

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      try {
        const results = await fetchLocationSuggestions(query, controller.signal);
        // The user may have kept typing while this was in flight.
        if (controller.signal.aborted || cityRef.current.trim() !== query) return;
        setSuggestions(results);
        setActiveIndex(0);
        setSuggestionsOpen(results.length > 0);
      } catch {
        // Aborted or offline: leave the dropdown closed.
      } finally {
        if (!controller.signal.aborted) setSuggestionsLoading(false);
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return cancelPendingSuggest;
  }, [city, cancelPendingSuggest]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (suggestAbortRef.current) suggestAbortRef.current.abort();
    };
  }, []);

  const handleCityChange = (value: string) => {
    setCity(value);

    if (value.trim().length < MIN_QUERY_LENGTH) {
      cancelPendingSuggest();
      setSuggestions([]);
      setSuggestionsLoading(false);
      closeSuggestions();
    }
  };

  const chooseLocation = useCallback(
    (location: LocationData) => {
      cancelPendingSuggest();
      setSuggestions([]);
      setSuggestionsLoading(false);
      closeSuggestions();
      onSelectLocation(location);
    },
    [cancelPendingSuggest, closeSuggestions, onSelectLocation]
  );

  const handleSelect = (location: LocationData) => {
    if (location.name !== cityRef.current) skipSuggestRef.current = true;
    setCity(location.name);
    chooseLocation(location);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      closeSuggestions();
      return;
    }

    if (!suggestionsOpen || suggestions.length === 0) {
      if (e.key === "ArrowDown" && suggestions.length > 0) {
        e.preventDefault();
        setSuggestionsOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      // Let the highlighted candidate win over the raw text, so pressing Enter
      // can never silently resolve to a different same-named city.
      e.preventDefault();
      const picked = suggestions[activeIndex];
      if (picked) handleSelect(picked);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = city.trim();
    if (!query) return;

    if (suggestionsOpen && suggestions[activeIndex]) {
      handleSelect(suggestions[activeIndex]);
      return;
    }

    onSearch(query);
  };

  const handlePresetClick = (preset: string) => {
    cancelPendingSuggest();
    setSuggestions([]);
    closeSuggestions();
    if (preset !== cityRef.current) skipSuggestRef.current = true;
    setCity(preset);
    onSearch(preset);
  };

  const showDropdown = suggestionsOpen && isSearchFocused && suggestions.length > 0;

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
                role="combobox"
                aria-label="Search city, country or location"
                aria-autocomplete="list"
                aria-expanded={showDropdown}
                aria-controls={LISTBOX_ID}
                aria-activedescendant={
                  showDropdown ? `${LISTBOX_ID}-${activeIndex}` : undefined
                }
                placeholder="Search city, country or location..."
                value={city}
                onChange={(e) => handleCityChange(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-400 focus:outline-none font-medium"
              />
              {suggestionsLoading && (
                <Loader2 className="w-3.5 h-3.5 text-sky-400 mr-2 animate-spin shrink-0" />
              )}
              <button
                type="submit"
                disabled={loading || !city.trim()}
                className="ml-2 px-3 py-1 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 text-sky-300 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {loading ? "Searching..." : "Search"}
              </button>

              {showDropdown && (
                <ul
                  id={LISTBOX_ID}
                  role="listbox"
                  aria-label="Location suggestions"
                  className="absolute left-0 right-0 top-full mt-2 z-30 max-h-72 overflow-y-auto rounded-2xl glass-panel border border-sky-400/20 shadow-2xl shadow-slate-950/40 py-1.5 no-scrollbar"
                >
                  {suggestions.map((location, index) => {
                    const label = formatSuggestionLabel(location);
                    const isActive = index === activeIndex;
                    return (
                      <li
                        key={`${location.name}-${location.latitude}-${location.longitude}`}
                        id={`${LISTBOX_ID}-${index}`}
                        role="option"
                        aria-selected={isActive}
                        // onMouseDown fires before the input's blur, so the
                        // click is not lost to the dropdown closing.
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => handleSelect(location)}
                        className={`flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-colors ${
                          isActive ? "bg-sky-500/20" : "hover:bg-slate-700/30"
                        }`}
                      >
                        <MapPin
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActive ? "text-sky-300" : "text-slate-500"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-100 truncate">
                            {location.name}
                          </p>
                          {label && (
                            <p className="text-[11px] text-slate-400 truncate">
                              {label}
                              {location.population
                                ? ` · ${populationFormatter.format(location.population)} people`
                                : ""}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
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

          {/* Weather Map trigger */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onOpenMap}
            aria-label="Open weather map"
            title="Open interactive weather map"
            className="p-2.5 rounded-2xl glass-panel-interactive text-slate-300 hover:text-sky-400 flex items-center gap-1.5 px-3 text-xs font-medium"
          >
            <Map className="w-4 h-4 text-sky-400" />
            <span className="hidden md:inline">Map</span>
          </motion.button>

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
