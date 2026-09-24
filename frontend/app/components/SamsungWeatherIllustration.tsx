"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTimeOfDay } from "../hooks/useTimeOfDay";

interface SamsungWeatherIllustrationProps {
  condition: string;
  className?: string;
  isNight?: boolean;
}

export function SamsungWeatherIllustration({
  condition,
  className = "w-48 h-48",
  isNight: propIsNight,
}: SamsungWeatherIllustrationProps) {
  const tod = useTimeOfDay();

  const isNight = useMemo(() => {
    if (propIsNight !== undefined) return propIsNight;
    return tod.isNight;
  }, [propIsNight, tod.isNight]);

  const cond = condition.toLowerCase();

  const isRain = cond.includes("rain") || cond.includes("shower") || cond.includes("drizzle");
  const isThunder = cond.includes("storm") || cond.includes("thunder");
  const isSnow = cond.includes("snow") || cond.includes("ice") || cond.includes("flurry");
  const isCloudy = cond.includes("cloud") || cond.includes("overcast");
  const isFog = cond.includes("fog") || cond.includes("mist") || cond.includes("haze");

  return (
    <div className={`relative flex items-center justify-center pointer-events-none select-none ${className}`}>
      {/* 1. SUNNY / CLEAR DAY */}
      {!isNight && !isRain && !isThunder && !isSnow && !isCloudy && !isFog && (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Rotating Solar Flare Ring */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
            className="absolute w-36 h-36 rounded-full border border-amber-300/30 border-dashed"
          />

          {/* Sun Outer Glow Pulse */}
          <motion.div
            animate={{ scale: [1, 1.12, 1], opacity: [0.6, 0.9, 0.6] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-32 h-32 bg-amber-400/25 rounded-full blur-xl"
          />

          {/* Sun Core Sphere */}
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="w-24 h-24 rounded-full bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-200 shadow-[0_0_50px_rgba(245,158,11,0.6)] border border-yellow-200/50 flex items-center justify-center relative overflow-hidden"
          >
            {/* Shimmer flare inside sun */}
            <div className="absolute top-2 left-3 w-8 h-8 rounded-full bg-white/40 blur-sm" />
          </motion.div>

          {/* Orbiting Lens Glints */}
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
            className="absolute w-44 h-44 pointer-events-none"
          >
            <div className="absolute top-0 left-10 w-2.5 h-2.5 rounded-full bg-yellow-200 shadow-[0_0_10px_#fde047]" />
            <div className="absolute bottom-2 right-12 w-3.5 h-3.5 rounded-full bg-amber-300/60 blur-[1px]" />
          </motion.div>
        </div>
      )}

      {/* 2. NIGHT CLEAR */}
      {isNight && !isRain && !isThunder && !isSnow && !isCloudy && !isFog && (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Moon Glow */}
          <motion.div
            animate={{ scale: [1, 1.1, 1], opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-32 h-32 bg-sky-400/20 rounded-full blur-xl"
          />

          {/* Crescent Moon */}
          <motion.div
            animate={{ y: [0, -5, 0], rotate: [0, 2, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="relative w-24 h-24"
          >
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-200 via-sky-300 to-indigo-400 shadow-[0_0_40px_rgba(56,189,248,0.5)] relative overflow-hidden">
              <div className="absolute -top-1 -right-2 w-20 h-20 rounded-full bg-slate-950" />
            </div>
          </motion.div>

          {/* Twinkling Stars */}
          {[
            { top: "15%", left: "20%", delay: 0 },
            { top: "25%", right: "15%", delay: 0.7 },
            { bottom: "20%", left: "25%", delay: 1.4 },
          ].map((star, i) => (
            <motion.div
              key={i}
              style={{ ...star, position: "absolute" }}
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: star.delay }}
              className="w-2 h-2 bg-sky-200 rounded-full shadow-[0_0_8px_#ffffff]"
            />
          ))}
        </div>
      )}

      {/* 3. RAIN / SHOWERS */}
      {isRain && (
        <div className="relative w-full h-full flex flex-col items-center justify-center">
          {/* Samsung Styled Cloud Layer */}
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10 w-36 h-20"
          >
            <div className="absolute bottom-0 w-36 h-12 rounded-2xl bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 shadow-xl border border-slate-500/30" />
            <div className="absolute bottom-4 left-4 w-16 h-16 rounded-full bg-slate-600 border border-slate-500/20" />
            <div className="absolute bottom-3 right-4 w-20 h-20 rounded-full bg-slate-600 border border-slate-500/20" />
          </motion.div>

          {/* Animated Falling Raindrops & Splash Drops */}
          <div className="absolute inset-0 pt-16 flex justify-center gap-3 overflow-hidden pointer-events-none">
            {[0, 1, 2, 3, 4].map((drop, idx) => (
              <motion.div
                key={idx}
                animate={{
                  y: [-10, 50],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: 0.9,
                  repeat: Infinity,
                  delay: idx * 0.18,
                  ease: "easeIn",
                }}
                className="w-1 h-5 rounded-full bg-gradient-to-b from-sky-400 to-blue-500 shadow-[0_0_8px_#38bdf8]"
              />
            ))}
          </div>
        </div>
      )}

      {/* 4. THUNDERSTORM */}
      {isThunder && (
        <div className="relative w-full h-full flex flex-col items-center justify-center">
          {/* Flashing Ambient Lighting */}
          <motion.div
            animate={{ opacity: [0.2, 0.8, 0.2, 0.9, 0.2] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="absolute w-40 h-40 bg-purple-500/25 rounded-full blur-2xl"
          />

          {/* Dark Storm Cloud */}
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10 w-36 h-20"
          >
            <div className="absolute bottom-0 w-36 h-12 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 shadow-2xl border border-purple-500/30" />
            <div className="absolute bottom-4 left-3 w-16 h-16 rounded-full bg-slate-800 border border-purple-500/20" />
            <div className="absolute bottom-3 right-3 w-20 h-20 rounded-full bg-indigo-950 border border-purple-500/20" />
          </motion.div>

          {/* Animated Lightning Bolt */}
          <motion.svg
            animate={{ opacity: [0, 1, 0, 1, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1 }}
            className="absolute z-20 w-10 h-14 top-14 text-amber-300 drop-shadow-[0_0_12px_rgba(252,211,77,0.9)]"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M13 2L3 14h7v8l11-12h-8z" />
          </motion.svg>
        </div>
      )}

      {/* 5. SNOW */}
      {isSnow && (
        <div className="relative w-full h-full flex flex-col items-center justify-center">
          {/* Soft Frost Cloud */}
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10 w-36 h-20"
          >
            <div className="absolute bottom-0 w-36 h-12 rounded-2xl bg-gradient-to-r from-slate-800 via-slate-700 to-sky-950 border border-cyan-400/30" />
            <div className="absolute bottom-4 left-4 w-16 h-16 rounded-full bg-slate-700" />
            <div className="absolute bottom-3 right-4 w-20 h-20 rounded-full bg-slate-700" />
          </motion.div>

          {/* Drifting Snowflakes */}
          {[0, 1, 2, 3].map((flake, idx) => (
            <motion.div
              key={idx}
              animate={{
                y: [-5, 45],
                x: [idx % 2 === 0 ? -10 : 10, idx % 2 === 0 ? 10 : -10],
                rotate: 360,
                opacity: [0, 1, 0],
              }}
              transition={{
                duration: 2.5,
                repeat: Infinity,
                delay: idx * 0.4,
                ease: "easeInOut",
              }}
              className="absolute z-20 top-14 w-3.5 h-3.5 rounded-full bg-cyan-100 shadow-[0_0_8px_#ecfeff]"
              style={{ left: `${30 + idx * 15}%` }}
            />
          ))}
        </div>
      )}

      {/* 6. CLOUDY / OVERCAST */}
      {isCloudy && !isRain && !isThunder && !isSnow && (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Back Cloud */}
          <motion.div
            animate={{ x: [-8, 8, -8] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-4 right-4 w-28 h-16 opacity-70"
          >
            <div className="absolute bottom-0 w-28 h-10 rounded-xl bg-slate-600" />
            <div className="absolute bottom-3 left-3 w-12 h-12 rounded-full bg-slate-600" />
          </motion.div>

          {/* Front Cloud */}
          <motion.div
            animate={{ x: [8, -8, 8], y: [0, -3, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-10 w-36 h-20"
          >
            <div className="absolute bottom-0 w-36 h-12 rounded-2xl bg-gradient-to-r from-sky-700 via-slate-600 to-sky-800 shadow-xl border border-sky-400/20" />
            <div className="absolute bottom-4 left-4 w-16 h-16 rounded-full bg-slate-600" />
            <div className="absolute bottom-3 right-4 w-20 h-20 rounded-full bg-sky-700" />
          </motion.div>
        </div>
      )}

      {/* 7. FOG / MIST */}
      {isFog && (
        <div className="relative w-full h-full flex flex-col items-center justify-center space-y-2">
          {[0, 1, 2].map((wave, idx) => (
            <motion.div
              key={idx}
              animate={{
                x: [idx % 2 === 0 ? -15 : 15, idx % 2 === 0 ? 15 : -15],
                opacity: [0.4, 0.8, 0.4],
              }}
              transition={{ duration: 4 + idx, repeat: Infinity, ease: "easeInOut" }}
              className="w-32 h-3.5 rounded-full bg-gradient-to-r from-slate-400/20 via-slate-300/40 to-slate-400/20 blur-[2px]"
            />
          ))}
        </div>
      )}
    </div>
  );
}

