import type { Coordinate } from "@/lib/domain";

const EARTH_RADIUS_M = 6371000;
const METERS_PER_MILE = 1609.344;

const toRad = (v: number) => (v * Math.PI) / 180;

export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE;
}

export function interpolateCoordinate(a: Coordinate, b: Coordinate, t: number): Coordinate {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
}

export function getPolylineDistanceMeters(points: Coordinate[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

export function sampleCheckpointsByMiles(points: Coordinate[], intervalMiles: number): Coordinate[] {
  if (points.length === 0) return [];
  if (points.length === 1) return points;

  const intervalMeters = intervalMiles * METERS_PER_MILE;
  const checkpoints: Coordinate[] = [points[0]];

  let nextTarget = intervalMeters;
  let travelled = 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const segment = haversineMeters(prev, curr);

    while (travelled + segment >= nextTarget) {
      const remainingToTarget = nextTarget - travelled;
      const t = Math.min(1, Math.max(0, remainingToTarget / segment));
      checkpoints.push(interpolateCoordinate(prev, curr, t));
      nextTarget += intervalMeters;
    }

    travelled += segment;
  }

  const last = points[points.length - 1];
  const tail = checkpoints[checkpoints.length - 1];
  if (tail.lat !== last.lat || tail.lon !== last.lon) {
    checkpoints.push(last);
  }

  return checkpoints;
}

export function thinCheckpoints(points: Coordinate[], maxPoints = 45): Coordinate[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const thinned = points.filter((_, idx) => idx % step === 0);
  const last = points[points.length - 1];
  const tail = thinned[thinned.length - 1];
  if (!tail || tail.lat !== last.lat || tail.lon !== last.lon) {
    thinned.push(last);
  }
  return thinned;
}

export function projectToSvg(points: Coordinate[], width: number, height: number, padding = 24): string[] {
  if (points.length === 0) return [];

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const drawableW = width - padding * 2;
  const drawableH = height - padding * 2;

  const lonSpan = Math.max(0.0001, maxLon - minLon);
  const latSpan = Math.max(0.0001, maxLat - minLat);

  return points.map((p) => {
    const x = padding + ((p.lon - minLon) / lonSpan) * drawableW;
    const y = padding + (1 - (p.lat - minLat) / latSpan) * drawableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
}
