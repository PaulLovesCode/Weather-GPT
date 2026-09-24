"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SkyScene } from "./SkyScene";
import { useTimeOfDay } from "../hooks/useTimeOfDay";

interface WeatherBackgroundProps {
  condition: string;
}

export function WeatherBackground({ condition }: WeatherBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tod = useTimeOfDay();
  const isNightRef = useRef(false);

  useEffect(() => {
    isNightRef.current = tod.isNight;
    const id = setTimeout(() => {
      isNightRef.current = tod.isNight;
    }, 200);
    return () => clearTimeout(id);
  }, [tod.isNight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let animationFrameId: number;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const setupDimensions = () => {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    setupDimensions();

    const handleResize = () => {
      setupDimensions();
    };

    window.addEventListener("resize", handleResize);

    const cond = condition.toLowerCase();

    const isRain = cond.includes("rain") || cond.includes("drizzle") || cond.includes("shower");
    const isThunder = cond.includes("storm") || cond.includes("thunder");
    const isSnow = cond.includes("snow") || cond.includes("ice") || cond.includes("flurry");
    const isCloud = cond.includes("cloud") || cond.includes("overcast");
    const isFog = cond.includes("fog") || cond.includes("mist") || cond.includes("haze");
    const isClear = !isRain && !isThunder && !isSnow && !isCloud && !isFog;

    const particleCount = prefersReducedMotion
      ? 10
      : isRain || isThunder
      ? 120
      : isSnow
      ? 80
      : isFog
      ? 40
      : isCloud
      ? 30
      : 45;

    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: isSnow
        ? Math.random() * 3 + 1.5
        : isRain || isThunder
        ? Math.random() * 1.5 + 0.8
        : isFog
        ? Math.random() * 160 + 60
        : Math.random() * 4 + 1,
      length: isRain || isThunder ? Math.random() * 20 + 10 : 0,
      speedY: prefersReducedMotion
        ? 0
        : isRain || isThunder
        ? Math.random() * 12 + 10
        : isSnow
        ? Math.random() * 1.2 + 0.4
        : isFog
        ? Math.random() * 0.3 + 0.1
        : isCloud
        ? Math.random() * 0.2 - 0.1
        : Math.random() * -0.25 - 0.15,
      speedX: prefersReducedMotion
        ? 0
        : isRain || isThunder
        ? Math.random() * 2 - 1
        : isSnow
        ? Math.random() * 0.8 - 0.4
        : isFog
        ? Math.random() * 0.6 + 0.3
        : isCloud
        ? Math.random() * 0.3 - 0.15
        : Math.random() * 0.4 - 0.2,
      opacity: isSnow
        ? Math.random() * 0.7 + 0.3
        : isRain || isThunder
        ? Math.random() * 0.5 + 0.2
        : isClear
        ? Math.random() * 0.35 + 0.15
        : Math.random() * 0.08 + 0.02,
      rise: Math.random() * Math.PI * 2,
    }));

    let flashCounter = 0;

    const renderNow = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      // Lightning flash
      if (isThunder && !prefersReducedMotion) {
        flashCounter++;
        if (flashCounter > 250 && Math.random() > 0.96) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
          ctx.fillRect(0, 0, width, height);
          flashCounter = 0;
        }
      }

      particles.forEach((p) => {
        if (isRain || isThunder) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.speedX * 2, p.y + p.length);
          ctx.strokeStyle = `rgba(186, 230, 253, ${p.opacity})`;
          ctx.lineWidth = p.size;
          ctx.stroke();

          if (!prefersReducedMotion) {
            p.y += p.speedY;
            p.x += p.speedX;

            if (p.y > height) {
              p.y = -20;
              p.x = Math.random() * width;
            }
          }
        } else if (isSnow) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(240, 249, 255, ${p.opacity})`;
          ctx.fill();

          if (!prefersReducedMotion) {
            p.y += p.speedY;
            p.x += Math.sin(p.y * 0.02) * p.speedX;

            if (p.y > height) {
              p.y = -10;
              p.x = Math.random() * width;
            }
          }
        } else if (isFog) {
          // Drifting fog banks
          const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          gradient.addColorStop(0, `rgba(226, 232, 240, ${p.opacity * 0.5})`);
          gradient.addColorStop(1, "rgba(226, 232, 240, 0)");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();

          if (!prefersReducedMotion) {
            p.x += p.speedX;
            if (p.x - p.size > width) {
              p.x = -p.size;
              p.y = Math.random() * height;
            }
          }
        } else if (isCloud) {
          const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          gradient.addColorStop(0, `rgba(148, 163, 184, ${p.opacity})`);
          gradient.addColorStop(1, "rgba(148, 163, 184, 0)");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();

          if (!prefersReducedMotion) {
            p.x += p.speedX;
            p.y += p.speedY;

            if (p.x < -p.size) p.x = width + p.size;
            if (p.x > width + p.size) p.x = -p.size;
            if (p.y < -p.size) p.y = height + p.size;
            if (p.y > height + p.size) p.y = -p.size;
          }
        } else {
          // Day: rising shimmering sun motes + subtle heat haze
          // Night: cool stardust drifting upward
          const night = isNightRef.current;
          const swayX = Math.sin(p.rise + time * 0.0012) * 6;
          ctx.beginPath();
          ctx.arc(p.x + swayX, p.y, p.size, 0, Math.PI * 2);
          ctx.globalAlpha = night ? p.opacity * 0.5 : p.opacity;
          ctx.fillStyle = night ? "#cbd5e1" : isClear ? "#fef3c7" : "#f59e0b";
          ctx.shadowColor = night ? "rgba(148,163,184,0.4)" : "#fde68a";
          ctx.shadowBlur = night ? 4 : 8;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;

          if (!prefersReducedMotion) {
            p.x += p.speedX;
            p.y += p.speedY;

            if (p.y < -10) {
              p.y = height + 10;
              p.x = Math.random() * width;
            }
          }
        }
      });
    };

    const renderLoop = () => {
      renderNow(performance.now());
      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(renderLoop);
      }
    };

    renderLoop();

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [condition]);

  const getAmbianceClass = () => {
    const cond = condition.toLowerCase();
    if (cond.includes("thunder") || cond.includes("storm")) return "weather-ambient-thunder";
    if (cond.includes("rain") || cond.includes("shower") || cond.includes("drizzle")) return "weather-ambient-rain";
    if (cond.includes("snow") || cond.includes("ice")) return "weather-ambient-snow";
    if (cond.includes("cloud") || cond.includes("overcast") || cond.includes("mist")) return "weather-ambient-cloud";
    return "weather-ambient-clear";
  };

  return (
    <div className="fixed inset-0 pointer-events-none">
      <SkyScene condition={condition} isNight={tod.isNight} />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-80" />

      {/* Framer-motion ambient glow overlay */}
      <AnimatePresence mode="sync">
        <motion.div
          key={`${condition}-${tod.phase}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
          className={`absolute inset-0 ${getAmbianceClass()}`}
        />
      </AnimatePresence>

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            tod.isNight
              ? "radial-gradient(ellipse at center, transparent 45%, rgba(2, 6, 23, 0.55) 100%)"
              : "radial-gradient(ellipse at center, transparent 55%, rgba(15, 23, 42, 0.35) 100%)",
        }}
      />
    </div>
  );
}