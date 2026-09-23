"use client";

import { useEffect, useRef } from "react";

interface WeatherBackgroundProps {
  condition: string;
}

export function WeatherBackground({ condition }: WeatherBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Check prefers-reduced-motion
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
    const isCloud = cond.includes("cloud") || cond.includes("overcast") || cond.includes("fog") || cond.includes("mist");

    // Particle setup
    const particleCount = prefersReducedMotion
      ? 10
      : isRain || isThunder
      ? 120
      : isSnow
      ? 80
      : isCloud
      ? 30
      : 20;

    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: isSnow ? Math.random() * 3 + 1.5 : isRain || isThunder ? Math.random() * 1.5 + 0.8 : Math.random() * 120 + 40,
      length: isRain || isThunder ? Math.random() * 20 + 10 : 0,
      speedY: prefersReducedMotion ? 0 : isRain || isThunder ? Math.random() * 12 + 10 : isSnow ? Math.random() * 1.2 + 0.4 : Math.random() * 0.2 - 0.1,
      speedX: prefersReducedMotion ? 0 : isRain || isThunder ? Math.random() * 2 - 1 : isSnow ? Math.random() * 0.8 - 0.4 : Math.random() * 0.3 - 0.15,
      opacity: isSnow ? Math.random() * 0.7 + 0.3 : isRain || isThunder ? Math.random() * 0.5 + 0.2 : Math.random() * 0.08 + 0.02,
    }));

    let flashCounter = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw lightning flash occasionally during thunder
      if (isThunder && !prefersReducedMotion) {
        flashCounter++;
        if (flashCounter > 250 && Math.random() > 0.96) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
          ctx.fillRect(0, 0, width, height);
          flashCounter = 0;
        }
      }

      // Render condition particles
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
        } else {
          // Soft ambient mist/cloud or sunny light dust
          const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          const color = isCloud ? "148, 163, 184" : "245, 158, 11";
          gradient.addColorStop(0, `rgba(${color}, ${p.opacity})`);
          gradient.addColorStop(1, `rgba(${color}, 0)`);

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
        }
      });

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

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
    <div className={`fixed inset-0 pointer-events-none transition-colors duration-1000 ${getAmbianceClass()}`}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-70" />
    </div>
  );
}
