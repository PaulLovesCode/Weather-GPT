"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getTimeOfDay } from "../hooks/useTimeOfDay";

interface SkySceneProps {
  condition: string;
  isNight?: boolean;
}

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;

uniform vec3 uTopDay;
uniform vec3 uMidDay;
uniform vec3 uHorizonDay;
uniform vec3 uTopNight;
uniform vec3 uMidNight;
uniform vec3 uHorizonNight;
uniform vec3 uTopDawn;
uniform vec3 uMidDawn;
uniform vec3 uHorizonDawn;
uniform float uDayMix;
uniform float uDawnMix;
uniform float uTime;
uniform float uNightStars;
uniform vec2 uSunPos;
uniform vec3 uSunGlow;
uniform float uSunGlowStrength;
uniform float uSunElevation;
uniform float uCloudCover;
uniform float uCloudDarken;
uniform float uFogMix;
uniform float uOvercast;
uniform float uFlash;
uniform float uLightningGlow;
uniform float uRainMist;
uniform float uSnowTint;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

vec3 blend(vec3 a, vec3 b, float t) {
  return a + (b - a) * clamp(t, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  float y = uv.y;

  // Base gradient by time of day
  vec3 top = blend(uTopNight, uTopDay, uDayMix);
  vec3 mid = blend(uMidNight, uMidDay, uDayMix);
  vec3 horizon = blend(uHorizonNight, uHorizonDay, uDayMix);

  top = blend(top, uTopDawn, uDawnMix);
  mid = blend(mid, uMidDawn, uDawnMix);
  horizon = blend(horizon, uHorizonDawn, uDawnMix);

  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.45, y));
  col = mix(col, top, smoothstep(0.45, 1.0, y));

  // Sun glow
  float dSun = distance(uv, uSunPos);
  float sunRadiance = exp(-dSun * uSunGlowStrength);
  float sunVisible = smoothstep(-0.05, 0.15, uSunElevation);
  col += uSunGlow * sunRadiance * 1.2 * sunVisible;
  col += uSunGlow * exp(-dSun * 9.0) * 0.6 * sunVisible;

  // Stars at night
  float starDensity = uNightStars * (1.0 - uCloudCover * 0.85);
  if (starDensity > 0.001) {
    vec2 cell = floor(uv * vec2(90.0, 55.0));
    float h = hash(cell);
    float star = step(0.985, h);
    float twinkle = 0.5 + 0.5 * sin(uTime * (1.0 + h * 4.0) + h * 40.0);
    float stars = star * twinkle * smoothstep(0.25, 0.7, y);
    col += vec3(stars * starDensity * 1.3);
  }

  // Cloud layer (wispy, drifting)
  vec2 cUv = uv * vec2(2.2, 3.2) + vec2(uTime * 0.02, uTime * 0.004);
  float clouds = fbm(cUv);
  float cloudMask = smoothstep(0.35, 0.85, clouds);
  vec3 cloudCol = blend(uMidNight, uHorizonDay, uDayMix);
  cloudCol = blend(cloudCol, vec3(1.0), uDawnMix * 0.6);
  col = blend(col, cloudCol, cloudMask * uCloudCover * 0.45);

  // Overcast darkening
  col *= 1.0 - uCloudDarken * 0.45;

  // Rain mist / fog veils
  float fog = fbm(uv * vec2(1.6, 2.8) + uTime * 0.014);
  col = blend(col, uMidDay * 0.85, fog * uFogMix * uRainMist * 0.35);

  // Snow cold tint
  col = blend(col, col + vec3(0.12, 0.16, 0.2), uSnowTint * 0.25);

  // Overcast flat grey wash
  col = blend(col, uHorizonDay * 0.9, uOvercast * smoothstep(0.2, 0.8, y) * 0.4);

  // Lightning flash
  col += vec3(uFlash * 0.9);
  col += vec3(0.6, 0.7, 1.0) * uLightningGlow * 0.45;

  gl_FragColor = vec4(col, 1.0);
}
`;

interface SkyUniforms {
  [key: string]: THREE.IUniform;
}

const DEFAULT_UNIFORMS: SkyUniforms = {
  uTopDay: { value: new THREE.Color("#2563eb") },
  uMidDay: { value: new THREE.Color("#60a5fa") },
  uHorizonDay: { value: new THREE.Color("#bae6fd") },
  uTopNight: { value: new THREE.Color("#020617") },
  uMidNight: { value: new THREE.Color("#0b1220") },
  uHorizonNight: { value: new THREE.Color("#1e293b") },
  uTopDawn: { value: new THREE.Color("#7c2d12") },
  uMidDawn: { value: new THREE.Color("#f59e0b") },
  uHorizonDawn: { value: new THREE.Color("#fde68a") },
  uDayMix: { value: 1.0 },
  uDawnMix: { value: 0.0 },
  uTime: { value: 0.0 },
  uNightStars: { value: 0.0 },
  uSunPos: { value: new THREE.Vector2(0.7, 0.35) },
  uSunElevation: { value: 0.5 },
  uSunGlow: { value: new THREE.Color("#fff7cc") },
  uSunGlowStrength: { value: 9.0 },
  uCloudCover: { value: 0.0 },
  uCloudDarken: { value: 0.0 },
  uFogMix: { value: 0.0 },
  uOvercast: { value: 0.0 },
  uFlash: { value: 0.0 },
  uLightningGlow: { value: 0.0 },
  uRainMist: { value: 0.0 },
  uSnowTint: { value: 0.0 },
};

export function SkyScene({ condition, isNight: propIsNight }: SkySceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const conditionRef = useRef(condition);
  const isNightRef = useRef(propIsNight);

  useEffect(() => {
    conditionRef.current = condition;
  }, [condition]);

  useEffect(() => {
    if (propIsNight !== undefined) isNightRef.current = propIsNight;
  }, [propIsNight]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.className = "absolute inset-0 w-full h-full";
    mount.appendChild(renderer.domElement);

    const uniforms: SkyUniforms = {
      ...DEFAULT_UNIFORMS,
    };

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const vertex = new THREE.Vector3();
    let flashIntensity = 0;

    const animate = () => {
      const t = performance.now() / 1000;

      const tod = getTimeOfDay();
      const isNight =
        isNightRef.current !== undefined ? isNightRef.current : tod.isNight;

      const dayMix = Math.max(0, Math.min(1, (tod.sunElevation + 0.28) * 1.6));
      const dawnMix =
        tod.phase === "dawn" || tod.phase === "dusk"
          ? 1.0 - Math.abs(tod.sunElevation) * 1.4
          : 0.0;

      uniforms.uTime.value = t;
      uniforms.uDayMix.value = dayMix;
      uniforms.uDawnMix.value = Math.max(0, Math.min(1, dawnMix));
      uniforms.uNightStars.value = isNight || dayMix < 0.35 ? 1.0 - dayMix : 0.0;

      const sunX = 0.5 + 0.42 * Math.sin(Math.PI * ((tod.hour - 12) / 12));
      const sunY = 0.08 + 0.86 * Math.max(0, tod.sunElevation);
      vertex.set(sunX, sunY, 0);
      uniforms.uSunPos.value.copy(vertex);
      uniforms.uSunElevation.value = tod.sunElevation;
      uniforms.uSunGlow.value.setHex(dayMix > 0.4 ? 0xfff7cc : 0xffc078);

      const cond = conditionRef.current.toLowerCase();
      const isRain = cond.includes("rain") || cond.includes("shower") || cond.includes("drizzle");
      const isThunder = cond.includes("storm") || cond.includes("thunder");
      const isSnow = cond.includes("snow") || cond.includes("ice") || cond.includes("flurry");
      const isCloud = cond.includes("cloud") || cond.includes("overcast");
      const isFog = cond.includes("fog") || cond.includes("mist") || cond.includes("haze");

      let cloudCover = 0.15;
      if (isRain) cloudCover = Math.max(cloudCover, 0.55);
      if (isThunder) cloudCover = Math.max(cloudCover, 0.9);
      if (isSnow) cloudCover = Math.max(cloudCover, 0.7);
      if (isCloud) cloudCover = Math.max(cloudCover, 0.85);
      if (isFog) cloudCover = Math.max(cloudCover, 0.4);

      uniforms.uCloudCover.value = cloudCover;
      uniforms.uCloudDarken.value = isThunder ? 1.0 : isCloud || isRain ? 0.5 : 0.0;
      uniforms.uFogMix.value = isFog ? 1.0 : 0.0;
      uniforms.uOvercast.value = isCloud ? 0.7 : isThunder ? 0.9 : isRain ? 0.4 : 0.0;
      uniforms.uSnowTint.value = isSnow ? 1.0 : 0.0;

      if (isRain || isThunder) {
        uniforms.uRainMist.value = 0.6 + (isThunder ? 0.4 : 0.0);
      } else {
        uniforms.uRainMist.value = 0.0;
      }

      if (isThunder) {
        if (Math.random() > 0.985) flashIntensity = 1.0;
        flashIntensity *= 0.88;
        uniforms.uFlash.value = flashIntensity;
        uniforms.uLightningGlow.value = Math.sin(t * 2.2) * 0.5 + 0.5;
      } else {
        uniforms.uFlash.value = 0.0;
        uniforms.uLightningGlow.value = 0.0;
      }

      renderer.render(scene, camera);
      frameRequestId = requestAnimationFrame(animate);
    };

    let frameRequestId = requestAnimationFrame(animate);

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(frameRequestId);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="absolute inset-0 w-full h-full" />;
}