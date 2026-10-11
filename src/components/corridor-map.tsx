"use client";

import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, ZoomControl } from "react-leaflet";
import { checkpointSnapshot, type CorridorLayer } from "@/lib/corridor";
import { RISK_COLORS, type RouteOption } from "@/lib/domain";
import { formatEta, formatInHr, formatMile, formatMph, formatTempF } from "@/lib/format";

export type { CorridorLayer } from "@/lib/corridor";

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

export function CorridorMap({ routes, selectedRouteId, forecastHour, layer, showAllRoutes = true }: CorridorMapProps) {
  const selected = routes.find((r) => r.id === selectedRouteId) ?? routes[0];
  if (!selected) return null;

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
          const snapshot = checkpointSnapshot(cp, forecastHour, layer);
          if (snapshot.dimmed) return null;

          return (
            <CircleMarker
              key={`${cp.mileMarker}-${idx}`}
              center={[cp.coordinate.lat, cp.coordinate.lon]}
              radius={5}
              pathOptions={{ color: "#e2e8f0", weight: 1, fillColor: snapshot.color, fillOpacity: 0.95 }}
            >
              <Popup>
                <div className="text-xs text-slate-900">
                  <p className="mb-1 flex items-center gap-1.5 font-semibold">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: RISK_COLORS[cp.riskScoreAtEta] }}
                    />
                    Mile {formatMile(cp.mileMarker)} — {cp.riskLabelAtEta} at ETA
                  </p>
                  <p>
                    <strong>ETA:</strong> {formatEta(cp.etaIso)}
                  </p>
                  <p>
                    <strong>Wind:</strong> {formatMph(cp.weatherAtEta.windMph)}
                  </p>
                  <p>
                    <strong>Rain:</strong> {formatInHr(cp.weatherAtEta.rainInHr)} •{" "}
                    <strong>Snow:</strong> {formatInHr(cp.weatherAtEta.snowInHr)}
                  </p>
                  <p>
                    <strong>Temp:</strong> {formatTempF(cp.weatherAtEta.temperatureF)}
                  </p>
                  <p className="mt-1 border-t border-slate-300 pt-1 text-slate-700">
                    <strong>
                      {layer} @ +{snapshot.hour}h:
                    </strong>{" "}
                    {snapshot.focus}
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
