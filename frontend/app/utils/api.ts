import { LocationData, WeatherData, ForecastResponse } from "../types/weather";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || "http://localhost:8000";

/**
 * Hard ceiling on any single request.
 *
 * Without this a slow or unreachable backend leaves the caller awaiting
 * forever, which shows the user a loading skeleton that never resolves. Timing
 * out turns that into an ordinary error the UI can surface.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Combine the caller's cancellation signal with a timeout.
 *
 * `AbortSignal.any` is used where available; the manual fallback keeps the
 * behaviour identical (including abort-reason propagation) on older engines.
 */
function withTimeout(signal?: AbortSignal, ms = REQUEST_TIMEOUT_MS): AbortSignal {
  const timeoutSignal = AbortSignal.timeout
    ? AbortSignal.timeout(ms)
    : (() => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new Error("Request timed out")), ms);
        return controller.signal;
      })();

  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }

  const controller = new AbortController();
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  if (signal.aborted) abort(signal.reason);
  else signal.addEventListener("abort", () => abort(signal.reason), { once: true });
  timeoutSignal.addEventListener("abort", () => abort(timeoutSignal.reason), {
    once: true,
  });
  return controller.signal;
}

/** True when a rejection is a timeout rather than a caller-initiated cancel. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * Short-lived client-side cache of suggestion queries. Typing a prefix and then
 * backspacing re-issues the same query constantly; this keeps that off the wire.
 */
const SUGGESTION_CACHE_TTL = 5 * 60 * 1000;
const suggestionCache = new Map<string, { at: number; data: LocationData[] }>();

function readSuggestionCache(query: string): LocationData[] | null {
  const hit = suggestionCache.get(query);
  if (!hit) return null;
  if (Date.now() - hit.at > SUGGESTION_CACHE_TTL) {
    suggestionCache.delete(query);
    return null;
  }
  return hit.data;
}

function writeSuggestionCache(query: string, data: LocationData[]) {
  if (suggestionCache.size > 50) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest !== undefined) suggestionCache.delete(oldest);
  }
  suggestionCache.set(query, { at: Date.now(), data });
}

/**
 * Query -> candidate locations, in the provider's relevance order.
 *
 * Never re-sort these client-side: the backend deliberately preserves the
 * provider's ranking, and reordering here is what previously made a search
 * resolve to a place the user never chose. Failures resolve to an empty list so
 * the dropdown simply stays closed.
 */
export async function fetchLocationSuggestions(
  query: string,
  signal?: AbortSignal
): Promise<LocationData[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cached = readSuggestionCache(trimmed.toLowerCase());
  if (cached) return cached;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/locations?city=${encodeURIComponent(trimmed)}`,
      { signal: withTimeout(signal) }
    );
    if (!response.ok) return [];

    const data = await response.json();
    if (data.error || !Array.isArray(data.results)) return [];

    writeSuggestionCache(trimmed.toLowerCase(), data.results);
    return data.results;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return [];
  }
}

/**
 * Build the query for a weather/forecast pair.
 *
 * When the location carries coordinates -- which it always does for a pick from
 * the search dropdown -- they are sent explicitly and the backend skips
 * geocoding entirely. That is what guarantees the weather shown belongs to the
 * place the user actually selected.
 */
function buildLocationQuery(location: LocationData): string {
  const params = new URLSearchParams();
  const hasCoords =
    typeof location.latitude === "number" && typeof location.longitude === "number";

  if (hasCoords) {
    params.set("lat", String(location.latitude));
    params.set("lon", String(location.longitude));
    params.set("name", location.name);
    if (location.country) params.set("country", location.country);
    if (location.admin1) params.set("admin1", location.admin1);
  } else {
    params.set("city", location.name.trim());
  }

  return params.toString();
}

export async function fetchCurrentAndForecastByLocation(
  location: LocationData,
  signal?: AbortSignal
): Promise<{ weather: WeatherData; forecast: ForecastResponse }> {
  const query = buildLocationQuery(location);

  // A single signal covers both requests so one timeout stops the pair.
  const requestSignal = withTimeout(signal);
  const [weatherRes, forecastRes] = await Promise.all([
    fetch(`${API_BASE_URL}/api/weather?${query}`, { signal: requestSignal }),
    fetch(`${API_BASE_URL}/api/forecast?${query}`, { signal: requestSignal }),
  ]);

  if (!weatherRes.ok) {
    throw new Error(`Failed to fetch current weather (${weatherRes.status})`);
  }
  if (!forecastRes.ok) {
    throw new Error(`Failed to fetch forecast (${forecastRes.status})`);
  }

  const [weatherData, forecastData] = await Promise.all([
    weatherRes.json(),
    forecastRes.json(),
  ]);

  if (weatherData.error) {
    throw new Error(weatherData.error);
  }
  if (forecastData.error) {
    throw new Error(forecastData.error);
  }

  return { weather: weatherData, forecast: forecastData };
}

export async function fetchCurrentAndForecastByCity(
  city: string,
  signal?: AbortSignal
): Promise<{ weather: WeatherData; forecast: ForecastResponse }> {
  return fetchCurrentAndForecastByLocation({ name: city }, signal);
}

export async function fetchCurrentAndForecastByCoords(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<{ weather: WeatherData; forecast: ForecastResponse }> {
  const response = await fetch(
    `${API_BASE_URL}/api/current?lat=${lat}&lon=${lon}`,
    { signal: withTimeout(signal) }
  );

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || `Failed to fetch weather (${response.status})`);
  }

  return {
    weather: { location: data.location, weather: data.weather },
    forecast: {
      location: data.location,
      forecast: data.forecast || [],
      hourly: data.hourly || [],
    },
  };
}

/**
 * Coarse city for the caller, from the backend's IP lookup.
 *
 * Only ever used to *refine* an already-rendered city, so any failure resolves
 * to `null` instead of throwing: the UI keeps whatever it is showing and the
 * notice explains that detection fell back.
 */
export async function fetchLocationByIp(
  signal?: AbortSignal
): Promise<LocationData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/location/by-ip`, {
      signal: withTimeout(signal, 5_000),
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (data.error) return null;
    if (typeof data.name !== "string" || !data.name.trim()) return null;
    if (
      typeof data.latitude !== "number" ||
      typeof data.longitude !== "number"
    ) {
      return null;
    }

    return {
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      country: data.country,
      admin1: data.admin1,
    };
  } catch {
    return null;
  }
}

export async function postChatMessage(
  message: string,
  previousLocation?: string | null
): Promise<{ reply?: string; location?: { name: string } }> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    signal: withTimeout(undefined, 30_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: message.trim(),
      previous_location: previousLocation || null,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "Chat request failed.");
  }

  return data;
}

