"use client";

import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, ZoomControl } from "react-leaflet";
import { RISK_COLORS, type CheckpointAnalysis, type RouteOption } from "@/lib/domain";

export type CorridorLayer = "risk" | "wind" | "precipitation" | "snow" | "closures";

type CorridorMapProps = {
  routes: RouteOption[];
  selectedRouteId: string;
  forecastHour: number;
  layer: CorridorLayer;
  showAllRoutes?: boolean;
};

function routeColor(index: number): string {
  return ["#38bdf8", "#a78bfa", "#2dd4bf"][index] ?? "#94a3b8";
}

function getLayerColor(cp: CheckpointAnalysis, layer: CorridorLayer, forecastHour: number): string {
  const h = Math.max(0, Math.min(71, forecastHour));

  if (layer === "risk") {
    const risk = cp.horizonRiskScores[h] ?? cp.riskScoreAtEta;
    return RISK_COLORS[risk];
  }

  if (layer === "closures") {
    const risk = cp.horizonRiskScores[h] ?? cp.riskScoreAtEta;
    return risk >= 4 ? "#7f1d1d" : "#334155";
  }

  if (layer === "wind") {
    const wind = cp.horizonWindMph?.[h] ?? cp.weatherAtEta.windMph;
    if (wind >= 55) return "#7f1d1d";
    if (wind >= 45) return "#ef4444";
    if (wind >= 35) return "#f97316";
    if (wind >= 25) return "#eab308";
    return "#22c55e";
  }

  if (layer === "precipitation") {
    const rain = cp.horizonRainInHr?.[h] ?? cp.weatherAtEta.rainInHr;
    if (rain > 1) return "#7f1d1d";
    if (rain >= 0.5) return "#ef4444";
    if (rain >= 0.25) return "#f97316";
    if (rain >= 0.1) return "#eab308";
    return "#22c55e";
  }

  const snow = cp.horizonSnowInHr?.[h] ?? cp.weatherAtEta.snowInHr;
  if (snow > 3) return "#7f1d1d";
  if (snow >= 2) return "#ef4444";
  if (snow >= 1) return "#f97316";
  if (snow >= 0.5) return "#eab308";
  return "#22c55e";
}

function buildPopup(cp: CheckpointAnalysis, forecastHour: number, layer: CorridorLayer): string {
  const h = Math.max(0, Math.min(71, forecastHour));
  const risk = cp.horizonRiskScores[h] ?? cp.riskScoreAtEta;
  const wind = cp.horizonWindMph?.[h] ?? cp.weatherAtEta.windMph;
  const rain = cp.horizonRainInHr?.[h] ?? cp.weatherAtEta.rainInHr;
  const snow = cp.horizonSnowInHr?.[h] ?? cp.weatherAtEta.snowInHr;

  const focus =
    layer === "wind"
      ? `${wind.toFixed(1)} mph wind`
      : layer === "precipitation"
        ? `${rain.toFixed(2)} in/hr rain`
        : layer === "snow"
          ? `${snow.toFixed(2)} in/hr snow`
          : layer === "closures"
            ? risk >= 4
              ? "No-travel likely"
              : "Passable"
            : `Risk ${risk}`;

  return `${focus}`;
}

export function CorridorMap({ routes, selectedRouteId, forecastHour, layer, showAllRoutes = true }: CorridorMapProps) {
  const selected = routes.find((r) => r.id === selectedRouteId) ?? routes[0];

  const renderedRoutes = showAllRoutes ? routes : [selected];
  const allPoints = renderedRoutes.flatMap((r) => r.geometry);
  const centerPoint = allPoints[Math.floor(allPoints.length / 2)] ?? { lat: 39, lon: -98 };
  const center: [number, number] = [centerPoint.lat, centerPoint.lon];

  return (
    <div className="overflow-hidden rounded-2xl border border-white/15 ring-1 ring-white/10">
      <MapContainer center={center} zoom={6} scrollWheelZoom zoomControl={false} style={{ width: "100%", height: 420 }}>
        <ZoomControl position="topright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {renderedRoutes.map((route, idx) => (
          <Polyline
            key={route.id}
            positions={route.geometry.map((p) => [p.lat, p.lon] as [number, number])}
            pathOptions={{
              color: routeColor(idx),
              weight: route.id === selectedRouteId ? 6 : 4,
              opacity: route.id === selectedRouteId ? 0.92 : 0.45,
            }}
          />
        ))}

        {selected.checkpoints.map((cp, idx) => {
          const h = Math.max(0, Math.min(71, forecastHour));
          const risk = cp.horizonRiskScores[h] ?? cp.riskScoreAtEta;
          if (layer === "closures" && risk < 4) return null;

          const color = getLayerColor(cp, layer, forecastHour);

          return (
            <CircleMarker
              key={`${cp.mileMarker}-${idx}`}
              center={[cp.coordinate.lat, cp.coordinate.lon]}
              radius={5}
              pathOptions={{ color: "#e2e8f0", weight: 1, fillColor: color, fillOpacity: 0.95 }}
            >
              <Popup>
                <div className="text-xs text-slate-900">
                  <p>
                    <strong>Mile:</strong> {cp.mileMarker}
                  </p>
                  <p>
                    <strong>Layer:</strong> {layer}
                  </p>
                  <p>
                    <strong>Snapshot (+{h}h):</strong> {buildPopup(cp, forecastHour, layer)}
                  </p>
                  <p>
                    <strong>Risk:</strong> {risk}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
