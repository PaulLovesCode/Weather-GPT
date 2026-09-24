export type WeatherUnit = "C" | "F";

export interface LocationData {
  name: string;
  admin1?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

export interface WeatherMetrics {
  temperature: number;
  feels_like: number;
  humidity: number;
  wind_speed: number;
  wind_direction?: number;
  precipitation: number;
  condition: string;
}

export interface WeatherData {
  location: LocationData;
  weather: WeatherMetrics;
}

export interface ForecastDay {
  date: string;
  temperature_max: number;
  temperature_min: number;
  precipitation: number;
  rain_probability: number;
  wind_speed_max: number;
  condition: string;
}

export interface HourlyPoint {
  time: string;
  raw_time?: string;
  temperature: number;
  rain_probability: number;
  condition: string;
  wind_speed?: number;
}

export interface ForecastResponse {
  location: LocationData;
  forecast: ForecastDay[];
  hourly?: HourlyPoint[];
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

