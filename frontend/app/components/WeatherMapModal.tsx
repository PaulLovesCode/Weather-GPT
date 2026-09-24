"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { motion } from "framer-motion";
import { X, Layers, MapPin, Loader2 } from "lucide-react";
import { fetchCurrentAndForecastByCoords } from "../utils/api";
import { WeatherUnit, WeatherData } from "../types/weather";

interface WeatherMapModalProps {
  unit: WeatherUnit;
  initialCoords?: { lat: number; lon: number };
  onClose: () => void;
  onSelectLocation: (lat: number, lon: number) => void;
}

type BaseMapKey = "streets" | "satellite";
type OverlayKey = "temperature" | "wind" | "rain";

interface GridPoint {
  lat: number;
  lon: number;
  temp: number;
  windSpeed: number;
  windDir: number;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics';
const RAINVIEWER_ATTRIBUTION =
  'Rain radar <a href="https://www.rainviewer.com" target="_blank" rel="noreferrer">RainViewer</a>';

function gridStepForZoom(zoom: number): number {
  if (zoom <= 3) return 10;
  if (zoom === 4) return 6;
  if (zoom === 5) return 4;
  if (zoom === 6) return 2;
  if (zoom === 7) return 1.25;
  if (zoom === 8) return 0.7;
  if (zoom === 9) return 0.4;
  return 0.2;
}

function tempColor(temp: number): string {
  if (temp <= -20) return "#38006d";
  if (temp <= -10) return "#2b4aed";
  if (temp <= 0) return "#00b8ff";
  if (temp <= 10) return "#00d47a";
  if (temp <= 20) return "#ffdd33";
  if (temp <= 30) return "#ff9a1f";
  if (temp <= 40) return "#ff4d2e";
  return "#a10d00";
}

function windSpeedColor(kmh: number): string {
  if (kmh < 10) return "#65a30d";
  if (kmh < 25) return "#38bdf8";
  if (kmh < 40) return "#2563eb";
  if (kmh < 60) return "#d946ef";
  if (kmh < 85) return "#f59e0b";
  return "#ef4444";
}

function buildWindHtml(dirDeg: number, color: string): string {
  const rot = dirDeg > 180 ? dirDeg - 360 : dirDeg;
  return `
    <span style="display:inline-block;transform:rotate(${rot}deg);color:${color};font-size:15px;line-height:1;text-shadow:0 0 2px rgba(255,255,255,0.9)">
      ↑
    </span>
  `;
}

function buildWeatherPopupHtml(weather: WeatherData, unit: WeatherUnit): string {
  const loc = weather.location || {};
  const c = weather.weather || {};
  const displayUnit = unit === "F" ? "°F" : "°C";
  const displayTemp =
    unit === "F"
      ? Math.round((c.temperature * 9) / 5 + 32)
      : Math.round(c.temperature);
  const place = [loc.name, loc.admin1, loc.country].filter(Boolean).join(", ");
  return `
    <div style="min-width:180px;font-family:system-ui,sans-serif;color:#0f172a">
      <div style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:4px">
        <span style="color:#0284c7">●</span> ${place || "Selected location"}
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-top:4px">
        <span style="font-size:24px;font-weight:800;line-height:1">${displayTemp}${displayUnit}</span>
        <span style="font-size:12px;color:#475569">${c.condition || "Conditions incoming"}</span>
      </div>
      <div style="font-size:11px;color:#475569;margin-top:6px;display:grid;gap:2px">
        <span>🌡 Feels like ${
          unit === "F"
            ? Math.round((c.feels_like * 9) / 5 + 32) + "°F"
            : Math.round(c.feels_like) + "°C"
        }</span>
        <span>💧 Humidity ${c.humidity ?? "—"}% &nbsp;·&nbsp; 🌬 ${Math.round(c.wind_speed ?? 0)} km/h</span>
      </div>
      <div id="map-popup-action" style="margin-top:10px">
        <span style="display:inline-block;padding:6px 12px;background:#0284c7;color:#fff;border-radius:10px;font-size:11px;font-weight:600">Open in app</span>
      </div>
    </div>
  `;
}

export function WeatherMapModal({
  unit,
  initialCoords,
  onClose,
  onSelectLocation,
}: WeatherMapModalProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const satelliteLayerRef = useRef<L.TileLayer | null>(null);
  const rainLayerRef = useRef<L.TileLayer | null>(null);
  const tempGroupRef = useRef<L.LayerGroup | null>(null);
  const windGroupRef = useRef<L.LayerGroup | null>(null);
  const clickMarkerRef = useRef<L.Marker | null>(null);

  const stateRef = useRef({ overlay: "temperature" as OverlayKey });
  const [overlay, setOverlayState] = useState<OverlayKey>("temperature");
  const [baseMap, setBaseMapState] = useState<BaseMapKey>("streets");
  const propsRef = useRef({ unit, initialCoords, onClose, onSelectLocation });

  useEffect(() => {
    propsRef.current = { unit, initialCoords, onClose, onSelectLocation };
  });

  const fetchGridRef = useRef<((overlay?: OverlayKey) => void) | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Initialize the Leaflet map once
  useEffect(() => {
    const container = mapRef.current;
    if (!container) return;

    const coords = propsRef.current.initialCoords;
    const map = L.map(container, {
      center: coords ? [coords.lat, coords.lon] : [20.5937, 78.9629],
      zoom: coords ? 8 : 5,
      zoomControl: true,
      attributionControl: true,
    });
    leafletMapRef.current = map;

    const streetLayer = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { maxZoom: 19, attribution: OSM_ATTRIBUTION }
    ).addTo(map);

    const rainLayer = L.tileLayer(
      "",
      {
        opacity: 0.65,
        attribution: RAINVIEWER_ATTRIBUTION,
        maxZoom: 16,
      }
    );

    const tempGroup = L.layerGroup().addTo(map);
    const windGroup = L.layerGroup();
    tempGroupRef.current = tempGroup;
    windGroupRef.current = windGroup;
    baseLayerRef.current = streetLayer;
    const satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: ESRI_ATTRIBUTION }
    );
    satelliteLayerRef.current = satelliteLayer;
    rainLayerRef.current = rainLayer;

    const clearOverlays = () => {
      tempGroupRef.current?.clearLayers();
      windGroupRef.current?.clearLayers();
    };

    const renderGrid = (points: GridPoint[]) => {
      clearOverlays();
      const overlay = stateRef.current.overlay;

      if (overlay === "rain") return;

      points.forEach((p) => {
        if (overlay === "temperature") {
          const marker = L.circleMarker([p.lat, p.lon], {
            radius: 5,
            color: tempColor(p.temp),
            weight: 0,
            fillColor: tempColor(p.temp),
            fillOpacity: 0.55,
          }).bindTooltip(
            `<b>${Math.round(p.temp)}°C</b> · ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`
          );
          tempGroup.addLayer(marker);
        } else if (overlay === "wind") {
          const color = windSpeedColor(p.windSpeed);
          const icon = L.divIcon({
            className: "wm-wind-icon",
            html: buildWindHtml(p.windDir, color),
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });
          const marker = L.marker([p.lat, p.lon], { interactive: false, icon }).bindTooltip(
            `<b>${Math.round(p.windSpeed)} km/h</b> at ${Math.round(p.windDir)}°`
          );
          windGroup.addLayer(marker);
        }
      });
    };

    const fetchGrid = async () => {
      const overlay = stateRef.current.overlay;
      if (overlay === "rain") {
        clearOverlays();
        return;
      }

      const bounds = map.getBounds();
      const step = gridStepForZoom(map.getZoom());
      const lats: number[] = [];
      const lons: number[] = [];

      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const latIdx = Math.max(4, Math.min(28, Math.round(bounds.getNorth() / step) - Math.round(bounds.getSouth() / step)));
      const lonIdx = Math.max(4, Math.min(40, Math.round(bounds.getEast() / step) - Math.round(bounds.getWest() / step)));
      const maxPoints = 480;

      for (let i = 0; i <= latIdx; i++) {
        for (let j = 0; j <= lonIdx; j++) {
          lats.push(lerp(bounds.getSouth(), bounds.getNorth(), i / latIdx));
          lons.push(lerp(bounds.getWest(), bounds.getEast(), j / lonIdx));
          if (lats.length >= maxPoints) break;
        }
        if (lats.length >= maxPoints) break;
      }

      if (lats.length === 0) return;

      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
          `&current=temperature_2m,wind_speed_10m,wind_direction_10m&forecast_days=1&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Open-Meteo grid request failed");
        const data = await res.json();

        const temps: number[] = data.current?.temperature_2m || [];
        const winds: number[] = data.current?.wind_speed_10m || [];
        const dirs: number[] = data.current?.wind_direction_10m || [];

        const points: GridPoint[] = lats.map((lat, idx) => ({
          lat,
          lon: lons[idx],
          temp: temps[idx] ?? 0,
          windSpeed: winds[idx] ?? 0,
          windDir: dirs[idx] ?? 0,
        }));

        renderGrid(points);
      } catch (err) {
        console.error("Open-Meteo grid fetch error:", err);
      }
    };
    fetchGridRef.current = fetchGrid;
    fetchGrid();

    const handleMoveEnd = () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        fetchGrid();
      }, 450);
    };
    map.on("moveend", handleMoveEnd);
    map.on("zoomend", handleMoveEnd);

    // Click on the map -> weather popup for that spot
    map.on("click", async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      if (clickMarkerRef.current) {
        map.removeLayer(clickMarkerRef.current);
        clickMarkerRef.current = null;
      }
      const icon = L.divIcon({
        className: "wm-pin-icon",
        html: '<span style="display:flex;width:34px;height:34px;align-items:center;justify-content:center;background:#0284c7;color:#fff;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 8px rgba(2,6,23,0.4)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg></span>',
        iconSize: [34, 34],
        iconAnchor: [17, 34],
      });
      const marker = L.marker([lat, lng], { icon });
      marker.addTo(map);
      clickMarkerRef.current = marker;

      let popup: L.Popup | null = null;
      popup = L.popup({ maxWidth: 300, closeButton: true, autoClose: false })
        .setLatLng([lat, lng])
        .setContent(
          `<div style="padding:14px;color:#0f172a;font-family:system-ui,sans-serif;text-align:center">
            <div style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:#0284c7;color:#fff;margin:0 auto 8px">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M12 8v4l3 2"/></svg>
            </div>
            <div style="font-size:12px;color:#475569">Fetching live weather…</div>
          </div>`
        )
        .addTo(map);

      try {
        const { weather } = await fetchCurrentAndForecastByCoords(lat, lng);
        const content = buildWeatherPopupHtml(weather, propsRef.current.unit);
        popup
          .setLatLng([lat, lng])
          .setContent(content);
        popup.update();

        // Delegate "Open in app" clicks
        window.setTimeout(() => {
          const action = document.getElementById("map-popup-action");
          if (action) {
            action.onclick = () => {
              propsRef.current.onClose();
              propsRef.current.onSelectLocation(lat, lng);
            };
          }
        }, 0);
      } catch (err) {
        console.error("Weather popup fetch error:", err);
        popup.setContent(
          '<div style="padding:14px;color:#ef4444;font-size:12px">Could not load weather for this location.</div>'
        );
        popup.update();
      }
    });

    // Radar layer population (RainViewer free API — no key)
    const loadRadar = async () => {
      try {
        const res = await fetch(
          "https://api.rainviewer.com/public/weather-maps.json",
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("RainViewer request failed");
        const data = await res.json();
        const frames = [...(data?.radar?.past || []), ...(data?.radar?.nowcast || [])];
        if (frames.length > 0) {
          const latest = frames[frames.length - 1];
          rainLayer.setUrl(
            `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/0/1_1.png`
          );
        }
      } catch (err) {
        console.error("RainViewer radar load error:", err);
      }
    };
    loadRadar();

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      map.remove();
      leafletMapRef.current = null;
    };
  }, []);

  // Toggle overlays / base maps (React state drives button highlight + labels)
  const setOverlay = (overlay: OverlayKey) => {
    stateRef.current.overlay = overlay;
    setOverlayState(overlay);
    const map = leafletMapRef.current;
    if (!map) return;

    const tempGroup = tempGroupRef.current!;
    const windGroup = windGroupRef.current!;

    if (overlay === "rain") {
      map.removeLayer(tempGroup);
      map.removeLayer(windGroup);
      if (rainLayerRef.current && !map.hasLayer(rainLayerRef.current)) {
        rainLayerRef.current.addTo(map);
      }
    } else {
      if (rainLayerRef.current && map.hasLayer(rainLayerRef.current)) {
        map.removeLayer(rainLayerRef.current);
      }
      if (!map.hasLayer(tempGroup)) tempGroup.addTo(map);
      if (!map.hasLayer(windGroup)) windGroup.addTo(map);
    }
    fetchGridRef.current?.();
  };

  const setBaseMap = (base: BaseMapKey) => {
    setBaseMapState(base);
    const map = leafletMapRef.current;
    if (!map) return;
    const street = baseLayerRef.current;
    const satellite = satelliteLayerRef.current;
    if (!street || !satellite) return;

    if (base === "satellite") {
      if (map.hasLayer(street)) map.removeLayer(street);
      if (!map.hasLayer(satellite)) satellite.addTo(map);
    } else {
      if (map.hasLayer(satellite)) map.removeLayer(satellite);
      if (!map.hasLayer(street)) street.addTo(map);
    }
  };

  const overlayButtons: { key: OverlayKey; label: string }[] = [
    { key: "temperature", label: "Temperature" },
    { key: "wind", label: "Wind" },
    { key: "rain", label: "Rain radar" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-sm flex flex-col"
    >
      <div className="relative z-10 flex items-center justify-between gap-3 p-3 sm:p-4 bg-slate-900/90 border-b border-slate-800 backdrop-blur-xl">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-2 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate">
              Interactive Weather Map
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              Tap any location to see its live conditions
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Close weather map"
          className="p-2.5 rounded-xl glass-panel-interactive text-slate-300 hover:text-white shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Layer control toolbar */}
      <div className="relative z-10 flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-900/90 border-b border-slate-800 backdrop-blur-xl">
        <div className="flex items-center gap-1.5 p-1 rounded-xl glass-panel">
          {(["streets", "satellite"] as BaseMapKey[]).map((b) => (
            <button
              key={b}
              onClick={() => setBaseMap(b)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all ${
                baseMap === b
                  ? "bg-sky-500 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 p-1 rounded-xl glass-panel flex-wrap">
          {overlayButtons.map((o) => (
            <button
              key={o.key}
              onClick={() => setOverlay(o.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                overlay === o.key
                  ? "bg-sky-500 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Leaflet map */}
      <div className="relative flex-1 min-h-0">
        <div ref={mapRef} className="absolute inset-0 h-full w-full" />
        <Loader2
          className="absolute bottom-3 right-3 z-[500] w-5 h-5 text-sky-400 animate-spin"
          style={{ display: "none" }}
          data-wm-spinner
        />
        <div className="absolute bottom-3 left-3 z-[500] flex items-center gap-1.5 text-[10px] text-slate-300 bg-slate-900/80 rounded-lg px-2.5 py-1.5 backdrop-blur-sm">
          <MapPin className="w-3 h-3 text-sky-400" />
          Tap map to load weather · drag to explore
          {overlay !== "rain" && (
            <span className="text-slate-500">· {overlayButtons.find((o) => o.key === overlay)?.label}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}