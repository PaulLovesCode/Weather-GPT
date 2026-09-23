"use client";

import { motion } from "framer-motion";

export function WeatherSkeleton() {
  return (
    <div className="w-full space-y-6 animate-pulse">
      {/* Hero Weather Card Skeleton */}
      <div className="rounded-3xl glass-panel p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-slate-800" />
            <div className="space-y-2">
              <div className="w-40 h-6 rounded-lg bg-slate-800" />
              <div className="w-24 h-3 rounded-lg bg-slate-800/60" />
            </div>
          </div>
          <div className="w-32 h-14 rounded-2xl bg-slate-800" />
          <div className="flex gap-2">
            <div className="w-16 h-7 rounded-xl bg-slate-800" />
            <div className="w-16 h-7 rounded-xl bg-slate-800" />
            <div className="w-24 h-7 rounded-xl bg-slate-800" />
          </div>
        </div>
        <div className="w-44 h-44 rounded-3xl bg-slate-800/50" />
      </div>

      {/* Metrics Grid Skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="glass-panel rounded-2xl p-5 h-36 flex flex-col justify-between">
            <div className="flex justify-between">
              <div className="w-16 h-3 rounded-md bg-slate-800" />
              <div className="w-4 h-4 rounded-md bg-slate-800" />
            </div>
            <div className="w-24 h-7 rounded-lg bg-slate-800" />
            <div className="w-full h-1.5 rounded-full bg-slate-800" />
          </div>
        ))}
      </div>

      {/* Forecast Section Skeleton */}
      <div className="space-y-3">
        <div className="w-36 h-8 rounded-xl bg-slate-800" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="glass-panel rounded-2xl p-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-800" />
              <div className="w-20 h-4 rounded-md bg-slate-800" />
            </div>
            <div className="w-32 h-2 rounded-full bg-slate-800 hidden md:block" />
            <div className="w-16 h-4 rounded-md bg-slate-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

