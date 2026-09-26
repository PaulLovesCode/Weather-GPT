"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, MapPin, X } from "lucide-react";
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
  LocationData,
} from "./types/weather";
import {
  fetchCurrentAndForecastByCity,
  fetchCurrentAndForecastByCoords,
  fetchCurrentAndForecastByLocation,
  fetchLocationByIp,
  postChatMessage,
} from "./utils/api";
import {
  FALLBACK_CITY,
  LOCATION_SOURCE_PRIORITY,
  LocationSource,
  deriveCityFromTimezone,
  describeGeolocationError,
  geolocationUnavailableReason,
} from "./utils/location";

/** Generous: the timezone city is already on screen while this runs. */
const GEOLOCATION_TIMEOUT_MS = 8000;

const WEATHER_CACHE_KEY = "atmosphere_weather_cache";
const CACHE_TTL = 15 * 60 * 1000;

interface CachedWeather {
  ts: number;
  data: { weather: WeatherData; forecast: ForecastResponse };
}

interface AutoRequest {
  source: LocationSource;
  controller: AbortController;
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
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [previousLocation, setPreviousLocation] = useState<string | null>(null);

  const activeAbortController = useRef<AbortController | null>(null);

  /**
   * Absolute, one-way session lock. Once the user picks a place, no automatic
   * source may overwrite it -- without this, a slow IP or GPS response landing
   * after the user's choice would silently move them.
   */
  const manualLocationRef = useRef(false);
  /** Priority of the location currently on screen. */
  const appliedSourceRef = useRef<LocationSource | null>(null);
  /** In-flight automatic requests, tracked per source so they do not cancel
   *  each other; a higher-priority result must never lose to a slower one. */
  const autoRequestsRef = useRef<AutoRequest[]>([]);
  /** Strict Mode double-invokes effects; geolocation must only run once. */
  const didInitRef = useRef(false);

  /** True when `source` may still replace what is currently displayed. */
  function canApply(source: LocationSource): boolean {
    if (manualLocationRef.current) return false;
    const applied = appliedSourceRef.current;
    if (applied === null) return true;
    return LOCATION_SOURCE_PRIORITY[source] > LOCATION_SOURCE_PRIORITY[applied];
  }

  function recordApplied(source: LocationSource, locationName?: string) {
    appliedSourceRef.current = source;
    if (locationName) lastLocationRef.current = locationName;
    setCity("");
    setLocationLoading(false);
    setLoading(false);
  }

  /**
   * Register an in-flight automatic request.
   *
   * Automatic requests are tracked per source rather than sharing one slot, so a
   * slow coarse lookup cannot cancel an in-flight precise one. Superseding
   * requests (anything of equal or lower priority) are cancelled, and a manual
   * action cancels every automatic request outright.
   */
  function beginAutoRequest(source: LocationSource): AbortController {
    const keep: AutoRequest[] = [];
    for (const entry of autoRequestsRef.current) {
      if (LOCATION_SOURCE_PRIORITY[entry.source] <= LOCATION_SOURCE_PRIORITY[source]) {
        entry.controller.abort();
      } else {
        keep.push(entry);
      }
    }

    const controller = new AbortController();
    autoRequestsRef.current = [...keep, { source, controller }];
    return controller;
  }

  function finishAutoRequest(source: LocationSource, controller: AbortController) {
    autoRequestsRef.current = autoRequestsRef.current.filter(
      (entry) => !(entry.source === source && entry.controller === controller)
    );
    if (autoRequestsRef.current.length === 0) {
      setLoading(false);
      setLocationLoading(false);
    }
  }

  /** Manual choice or map selection: drop every pending automatic request. */
  function abortAutomaticRequests() {
    for (const entry of autoRequestsRef.current) {
      entry.controller.abort();
    }
    autoRequestsRef.current = [];
  }

  const handleSetUnit = (newUnit: WeatherUnit) => {
    setUnit(newUnit);
    try {
      localStorage.setItem("atmosphere_unit", newUnit);
    } catch {
      // Ignore localStorage write error
    }
  };

  /**
   * Paint a location the user did not choose, subject to the priority rules.
   *
   * Returns whether the result was applied so callers can tell the difference
   * between "shown" and "rejected as stale".
   */
  async function applyAutomaticCity(
    city: string,
    source: LocationSource,
    detail: string
  ): Promise<boolean> {
    if (!canApply(source)) return false;

    const controller = beginAutoRequest(source);
    setLoading(true);
    setError("");

    try {
      const { weather: wData, forecast: fData } =
        await fetchCurrentAndForecastByCity(city, controller.signal);

      if (erroredWithAbort(controller)) return false;
      // The user may have searched, or a better source won, while this awaited.
      if (!canApply(source)) return false;

      writeWeatherCache({ weather: wData, forecast: fData });

      setWeather(wData);
      setForecast(fData.forecast || []);
      setHourly(fData.hourly || []);

      if (wData.location?.name) {
        setPreviousLocation(wData.location.name);
      }

      setLocationNotice(detail);
      recordApplied(source, wData.location?.name || city);
      return true;
    } catch (err: unknown) {
      if (erroredWithAbort(controller, err)) return false;
      console.error(`Automatic location failed (${source}):`, err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to AtmosphereAI backend."
      );
      return false;
    } finally {
      finishAutoRequest(source, controller);
    }
  }

  function erroredWithAbort(
    controller: AbortController,
    err?: unknown
  ): boolean {
    if (err && (err as Error).name === "AbortError") return true;
    return controller.signal.aborted;
  }

  /**
   * Startup location resolution.
   *
   * Priority is GPS > IP > timezone > fixed default, and the ordering is
   * enforced by `canApply` so arrival order never matters:
   *
   *  1. The browser's time zone gives a real city immediately -- no network.
   *  2. A GPS prompt runs in parallel and replaces it if the user allows it.
   *  3. IP lookup runs only after GPS has failed, and only in the background,
   *     because it is the least accurate source and the least private.
   *  4. If nothing resolves, the fixed default loads and the notice explains
   *     why, instead of appearing to know the user's location.
   */
  async function initializeLocation() {
    setLocationLoading(true);

    const unavailableReason = geolocationUnavailableReason();
    const timezoneCity = deriveCityFromTimezone();

    // Start the GPS prompt *before* awaiting anything else. Waiting for the
    // timezone load first would delay (or, if that request stalled, entirely
    // skip) the one prompt that yields the most accurate answer.
    const refinement = refineByGpsOrIp(unavailableReason);

    if (timezoneCity) {
      await applyAutomaticCity(
        timezoneCity,
        "timezone",
        `Showing ${timezoneCity} from your time zone.`
      );
    } else {
      // Nothing on screen yet, so give the pending refinement a brief chance to
      // paint something before falling back to the fixed default.
      await Promise.race([refinement, delay(1500)]);
    }

    if (appliedSourceRef.current === null && canApply("default")) {
      await applyAutomaticCity(
        FALLBACK_CITY,
        "default",
        unavailableReason ??
          `Showing ${FALLBACK_CITY}. Allow location access to see local weather.`
      );
    }

    setLocationLoading(false);
    // Deliberately not awaited: GPS/IP may still refine what is on screen.
    void refinement;
  }

  /**
   * Ask for GPS, then fall back to IP if that is refused.
   *
   * Always settles, so the caller can race against it without leaking a pending
   * promise if GPS is superseded while its weather request is in flight.
   */
  async function refineByGpsOrIp(unavailableReason: string | null) {
    if (unavailableReason) {
      // No usable geolocation API, so IP is the only refinement left.
      await applyIpRefinement();
      return;
    }

    const gpsResult = await new Promise<"ok" | "denied">((resolve) => {
      let settled = false;
      const settle = (result: "ok" | "denied") => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          void applyGpsPosition(position.coords.latitude, position.coords.longitude)
            .catch((err: unknown) => {
              console.error("Coordinate fetch error:", err);
            })
            .finally(() => settle("ok"));
        },
        (geoError) => {
          console.warn(
            `Geolocation failed (code ${geoError?.code}): ${describeGeolocationError(
              geoError
            )}`
          );
          settle("denied");
        },
        {
          enableHighAccuracy: false,
          timeout: GEOLOCATION_TIMEOUT_MS,
          maximumAge: 300000,
        }
      );
    });

    if (gpsResult === "denied") {
      await applyIpRefinement();
    }
  }

  async function applyGpsPosition(latitude: number, longitude: number) {
    if (!canApply("gps")) return;

    const controller = beginAutoRequest("gps");
    setLoading(true);

    try {
      const { weather: wData, forecast: fData } =
        await fetchCurrentAndForecastByCoords(
          latitude,
          longitude,
          controller.signal
        );

      // A manual choice or a better source may have landed while this awaited.
      if (erroredWithAbort(controller)) return;
      if (!canApply("gps")) return;

      writeWeatherCache({ weather: wData, forecast: fData });
      setWeather(wData);
      setForecast(fData.forecast || []);
      setHourly(fData.hourly || []);
      if (wData.location?.name) {
        setPreviousLocation(wData.location.name);
      }
      // GPS is precise, so the fallback notice is no longer accurate.
      setLocationNotice(null);
      recordApplied("gps", wData.location?.name);
    } finally {
      finishAutoRequest("gps", controller);
    }
  }

  /** Coarse network location, used only after GPS is unavailable. */
  async function applyIpRefinement() {
    if (!canApply("ip")) return;

    const ipLocation = await fetchLocationByIp();
    if (!ipLocation?.name) return;

    await applyAutomaticCity(
      ipLocation.name,
      "ip",
      `Showing ${ipLocation.name} from your network location.`
    );
  }

  /** Last location actually painted, so Retry never falls back to a hardcoded city. */
  const lastLocationRef = useRef<string>("");

  /**
   * Re-run whichever load failed.
   *
   * Deliberately does not engage the manual lock: retrying a request the app
   * made on its own must not be mistaken for the user choosing a place.
   */
  function retryLastLoad() {
    if (!manualLocationRef.current) {
      // Let the same automatic source try again.
      appliedSourceRef.current = null;
      void initializeLocation();
      return;
    }
    void searchWeather(city || lastLocationRef.current);
  }

  /**
   * GPS on demand, from the header button or the fallback notice.
   *
   * This is a manual request, so it deliberately ignores the manual-location
   * lock: the lock exists to stop *automatic* detection from overriding a
   * choice, and the user clicking this button is the override. It must never
   * become a silent no-op.
   */
  function requestPreciseLocation() {
    const unavailableReason = geolocationUnavailableReason();
    if (unavailableReason) {
      setLocationNotice(unavailableReason);
      return;
    }

    setLocationNotice(null);
    setLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadWeatherByCoords(position.coords.latitude, position.coords.longitude);
      },
      (geoError) => {
        setLoading(false);
        setLocationNotice(describeGeolocationError(geoError));
      },
      {
        enableHighAccuracy: false,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: 60000,
      }
    );
  }

  function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function loadWeatherByCoords(latitude: number, longitude: number) {
    // Choosing a point on the map is an explicit choice like any other search.
    manualLocationRef.current = true;
    abortAutomaticRequests();
    setLocationNotice(null);

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

    // Free-text search is a deliberate choice, so it locks out auto-detection.
    manualLocationRef.current = true;
    abortAutomaticRequests();
    setLocationNotice(null);

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
        lastLocationRef.current = wData.location.name;
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

  /**
   * Load weather for a location the user picked from the search dropdown.
   *
   * The chosen coordinates are sent to the backend as-is, so the forecast always
   * belongs to the exact place that was clicked rather than to a fresh
   * geocoding of the same (possibly ambiguous) name.
   */
  async function searchWeatherByLocation(location: LocationData) {
    manualLocationRef.current = true;
    abortAutomaticRequests();
    setLocationNotice(null);

    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }
    const controller = new AbortController();
    activeAbortController.current = controller;

    setLoading(true);
    setError("");

    try {
      const { weather: wData, forecast: fData } =
        await fetchCurrentAndForecastByLocation(location, controller.signal);

      writeWeatherCache({ weather: wData, forecast: fData });

      setWeather(wData);
      setForecast(fData.forecast || []);
      setHourly(fData.hourly || []);

      // Keep the input and chat context in sync with the explicit pick.
      if (location.name) {
        setCity(location.name);
        setPreviousLocation(location.name);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Location search error:", err);
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

  // Declared last so every handler above is in scope. Restore cached weather
  // instantly on mount (stale-while-revalidate), then resolve the location.
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

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

    // A previously cached city is itself a manual choice: keep it locked in.
    if (cached && cached.data.weather?.location?.name) {
      manualLocationRef.current = true;
      lastLocationRef.current = cached.data.weather.location.name;
    }

    void initializeLocation();
    // Mount-only by design: `didInitRef` above is the real guard, and adding
    // initializeLocation (which closes over every handler) to the dependency
    // list would re-run geolocation whenever any of them changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative min-h-screen text-slate-100 font-sans selection:bg-sky-500/30 selection:text-sky-200">
      {/* Condition Canvas Weather Background */}
      <WeatherBackground condition={weather?.weather.condition || "Clear"} />

      {/* Header Bar */}
      <WeatherHeader
        city={city}
        setCity={setCity}
        onSearch={searchWeather}
        onSelectLocation={searchWeatherByLocation}
        onLocate={requestPreciseLocation}
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
                onClick={retryLastLoad}
                className="px-3 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 font-bold transition-colors"
              >
                Retry
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/*
          Soft, dismissible notice. Distinct from the hard error banner above:
          nothing is broken here, we simply do not know exactly where the user is.
        */}
        <AnimatePresence>
          {locationNotice && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-3 sm:p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-200 text-xs font-medium flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="min-w-0">{locationNotice}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={requestPreciseLocation}
                  className="px-3 py-1 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-100 font-bold transition-colors"
                >
                  Use my location
                </button>
                <button
                  onClick={() => setLocationNotice(null)}
                  aria-label="Dismiss location notice"
                  className="p-1 rounded-lg hover:bg-sky-500/20 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
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