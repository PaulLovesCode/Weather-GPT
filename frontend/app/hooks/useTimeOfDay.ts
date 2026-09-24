"use client";

import { useEffect, useState } from "react";

export type TimePhase = "dawn" | "day" | "dusk" | "night";

export interface TimeOfDay {
  hour: number;
  phase: TimePhase;
  isNight: boolean;
  sunElevation: number;
}

const DAWN_START = 5;
const DAY_START = 8;
const DUSK_START = 17;
const NIGHT_START = 20;

function sunElevationForHour(hour: number): number {
  return Math.cos((Math.PI * (hour - 12)) / 12);
}

function phaseForHour(hour: number): TimePhase {
  if (hour >= NIGHT_START || hour < DAWN_START) return "night";
  if (hour >= DAY_START && hour < DUSK_START) return "day";
  if (hour >= DUSK_START) return "dusk";
  return "dawn";
}

export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getHours() + date.getMinutes() / 60;
  const phase = phaseForHour(hour);
  return {
    hour,
    phase,
    isNight: phase === "night",
    sunElevation: sunElevationForHour(hour),
  };
}

export function useTimeOfDay(intervalMs = 60000): TimeOfDay {
  const [time, setTime] = useState<TimeOfDay>(() => getTimeOfDay());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTime(getTimeOfDay());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return mounted
    ? time
    : { ...time, isNight: false, phase: time.phase === "night" ? "dusk" : time.phase };
}