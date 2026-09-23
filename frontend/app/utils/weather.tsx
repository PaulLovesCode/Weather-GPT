import React from "react";
import {
  Sun,
  CloudRain,
  CloudLightning,
  Snowflake,
  CloudFog,
  Cloud,
  CloudSun,
} from "lucide-react";
import { WeatherUnit } from "../types/weather";

export function convertTemp(celsius: number, unit: WeatherUnit): number {
  if (unit === "F") {
    return Math.round((celsius * 9) / 5 + 32);
  }
  return Math.round(celsius);
}

export function convertWindSpeed(
  kmh: number,
  unit: WeatherUnit
): { value: number; label: string } {
  if (unit === "F") {
    // Convert km/h to mph: 1 km/h = 0.621371 mph
    return {
      value: Math.round(kmh * 0.621371 * 10) / 10,
      label: "mph",
    };
  }
  return {
    value: Math.round(kmh * 10) / 10,
    label: "km/h",
  };
}

export function getBeaufortScale(windSpeedKmh: number): {
  label: string;
  description: string;
} {
  if (windSpeedKmh < 1) return { label: "Calm", description: "Smoke rises vertically" };
  if (windSpeedKmh <= 5) return { label: "Light air", description: "Smoke drift indicates direction" };
  if (windSpeedKmh <= 11) return { label: "Light breeze", description: "Wind felt on exposed skin" };
  if (windSpeedKmh <= 19) return { label: "Gentle breeze", description: "Leaves and twigs in motion" };
  if (windSpeedKmh <= 28) return { label: "Moderate breeze", description: "Small branches move, dust raised" };
  if (windSpeedKmh <= 38) return { label: "Fresh breeze", description: "Small trees begin to sway" };
  if (windSpeedKmh <= 49) return { label: "Strong breeze", description: "Large branches in motion" };
  if (windSpeedKmh <= 61) return { label: "High wind", description: "Whole trees in motion" };
  if (windSpeedKmh <= 74) return { label: "Gale", description: "Twigs break off trees" };
  return { label: "Severe gale / storm", description: "Structural damage possible" };
}

export function getWeatherIconComponent(condition: string, className = "w-16 h-16") {
  const value = condition.toLowerCase();

  if (value.includes("rain") || value.includes("shower") || value.includes("drizzle")) {
    return <CloudRain className={`${className} text-sky-400`} />;
  }
  if (value.includes("storm") || value.includes("thunder")) {
    return <CloudLightning className={`${className} text-purple-400`} />;
  }
  if (value.includes("snow") || value.includes("ice") || value.includes("flurry")) {
    return <Snowflake className={`${className} text-cyan-200`} />;
  }
  if (value.includes("fog") || value.includes("mist") || value.includes("haze")) {
    return <CloudFog className={`${className} text-slate-300`} />;
  }
  if (value.includes("clear") || value.includes("sunny")) {
    return <Sun className={`${className} text-amber-400 animate-spin-slow`} />;
  }
  if (value.includes("cloud") || value.includes("overcast")) {
    return <Cloud className={`${className} text-blue-300`} />;
  }
  return <CloudSun className={`${className} text-sky-300`} />;
}

