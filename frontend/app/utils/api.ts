import { WeatherData, ForecastResponse } from "../types/weather";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || "http://localhost:8000";

export async function fetchCurrentAndForecastByCity(
  city: string,
  signal?: AbortSignal
): Promise<{ weather: WeatherData; forecast: ForecastResponse }> {
  const encCity = encodeURIComponent(city.trim());

  const [weatherRes, forecastRes] = await Promise.all([
    fetch(`${API_BASE_URL}/api/weather?city=${encCity}`, { signal }),
    fetch(`${API_BASE_URL}/api/forecast?city=${encCity}`, { signal }),
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

export async function fetchCurrentAndForecastByCoords(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<{ weather: WeatherData; forecast: ForecastResponse }> {
  const [weatherRes, forecastRes] = await Promise.all([
    fetch(`${API_BASE_URL}/api/weather/current?lat=${lat}&lon=${lon}`, { signal }),
    fetch(`${API_BASE_URL}/api/forecast/current?lat=${lat}&lon=${lon}`, { signal }),
  ]);

  if (!weatherRes.ok) {
    throw new Error(`Failed to fetch weather for coordinates (${weatherRes.status})`);
  }
  if (!forecastRes.ok) {
    throw new Error(`Failed to fetch forecast for coordinates (${forecastRes.status})`);
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

export async function postChatMessage(
  message: string,
  previousLocation?: string | null
): Promise<{ reply?: string; location?: { name: string } }> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
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

