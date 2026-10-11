import { getPolylineDistanceMeters, interpolateCoordinate } from "@/lib/geo";
import type { Coordinate } from "@/lib/domain";

/**
 * Offline corridor fallback for environments where Nominatim / OSRM cannot be
 * reached (locked-down sandboxes, CI, air-gapped demos).
 *
 * DISABLED BY DEFAULT. When the flag is off, every call site behaves exactly as
 * before and simply rethrows the upstream error. A dispatcher must never be shown
 * an invented route or fabricated coordinates, so this is only ever enabled
 * deliberately via ALLOW_OFFLINE_ROUTE_FALLBACK=1 (see README).
 */
export function offlineFallbackEnabled(): boolean {
  return process.env.ALLOW_OFFLINE_ROUTE_FALLBACK === "1";
}

type GazetteerEntry = { name: string; state: string; lat: number; lon: number };

/** Major North American freight cities, used only when geocoding is unreachable. */
const GAZETTEER: GazetteerEntry[] = [
  { name: "Dallas", state: "TX", lat: 32.7767, lon: -96.797 },
  { name: "Fort Worth", state: "TX", lat: 32.7555, lon: -97.3308 },
  { name: "Houston", state: "TX", lat: 29.7604, lon: -95.3698 },
  { name: "San Antonio", state: "TX", lat: 29.4241, lon: -98.4936 },
  { name: "Austin", state: "TX", lat: 30.2672, lon: -97.7431 },
  { name: "El Paso", state: "TX", lat: 31.7619, lon: -106.485 },
  { name: "Oklahoma City", state: "OK", lat: 35.4676, lon: -97.5164 },
  { name: "Tulsa", state: "OK", lat: 36.154, lon: -95.9928 },
  { name: "Denver", state: "CO", lat: 39.7392, lon: -104.9903 },
  { name: "Colorado Springs", state: "CO", lat: 38.8339, lon: -104.8214 },
  { name: "Albuquerque", state: "NM", lat: 35.0844, lon: -106.6504 },
  { name: "Phoenix", state: "AZ", lat: 33.4484, lon: -112.074 },
  { name: "Tucson", state: "AZ", lat: 32.2226, lon: -110.9747 },
  { name: "Las Vegas", state: "NV", lat: 36.1699, lon: -115.1398 },
  { name: "Los Angeles", state: "CA", lat: 34.0522, lon: -118.2437 },
  { name: "San Francisco", state: "CA", lat: 37.7749, lon: -122.4194 },
  { name: "Sacramento", state: "CA", lat: 38.5816, lon: -121.4944 },
  { name: "Portland", state: "OR", lat: 45.5152, lon: -122.6784 },
  { name: "Seattle", state: "WA", lat: 47.6062, lon: -122.3321 },
  { name: "Salt Lake City", state: "UT", lat: 40.7608, lon: -111.891 },
  { name: "Boise", state: "ID", lat: 43.615, lon: -116.2023 },
  { name: "Kansas City", state: "MO", lat: 39.0997, lon: -94.5786 },
  { name: "Omaha", state: "NE", lat: 41.2565, lon: -95.9345 },
  { name: "Des Moines", state: "IA", lat: 41.5868, lon: -93.625 },
  { name: "Minneapolis", state: "MN", lat: 44.9778, lon: -93.265 },
  { name: "Chicago", state: "IL", lat: 41.8781, lon: -87.6298 },
  { name: "St Louis", state: "MO", lat: 38.627, lon: -90.1994 },
  { name: "Indianapolis", state: "IN", lat: 39.7684, lon: -86.1581 },
  { name: "Columbus", state: "OH", lat: 39.9612, lon: -82.9988 },
  { name: "Cincinnati", state: "OH", lat: 39.1031, lon: -84.512 },
  { name: "Detroit", state: "MI", lat: 42.3314, lon: -83.0458 },
  { name: "Nashville", state: "TN", lat: 36.1627, lon: -86.7816 },
  { name: "Memphis", state: "TN", lat: 35.1495, lon: -90.049 },
  { name: "Atlanta", state: "GA", lat: 33.749, lon: -84.388 },
  { name: "Charlotte", state: "NC", lat: 35.2271, lon: -80.8431 },
  { name: "Raleigh", state: "NC", lat: 35.7796, lon: -78.6382 },
  { name: "Louisville", state: "KY", lat: 38.2527, lon: -85.7585 },
  { name: "Little Rock", state: "AR", lat: 34.7465, lon: -92.2896 },
  { name: "New Orleans", state: "LA", lat: 29.9511, lon: -90.0715 },
  { name: "New York", state: "NY", lat: 40.7128, lon: -74.006 },
  { name: "Philadelphia", state: "PA", lat: 39.9526, lon: -75.1652 },
  { name: "Pittsburgh", state: "PA", lat: 40.4406, lon: -79.9959 },
  { name: "Baltimore", state: "MD", lat: 39.2904, lon: -76.6122 },
  { name: "Washington", state: "DC", lat: 38.9072, lon: -77.0369 },
  { name: "Jacksonville", state: "FL", lat: 30.3322, lon: -81.6557 },
  { name: "Orlando", state: "FL", lat: 28.5383, lon: -81.3792 },
  { name: "Tampa", state: "FL", lat: 27.9506, lon: -82.4572 },
  { name: "Miami", state: "FL", lat: 25.7617, lon: -80.1918 },
  { name: "Milwaukee", state: "WI", lat: 43.0389, lon: -87.9065 },
  { name: "Winnipeg", state: "MB", lat: 49.8951, lon: -97.1384 },

  // India - major freight / logistics corridors
  { name: "Chandigarh", state: "PB", lat: 30.7333, lon: 76.7794 },
  { name: "Mohali", state: "PB", lat: 30.6801, lon: 76.7006 },
  { name: "Panchkula", state: "HR", lat: 30.6917, lon: 76.8537 },
  { name: "Ludhiana", state: "PB", lat: 30.901, lon: 75.8573 },
  { name: "Jalandhar", state: "PB", lat: 31.326, lon: 75.5762 },
  { name: "Amritsar", state: "PB", lat: 31.634, lon: 74.8723 },
  { name: "Bathinda", state: "PB", lat: 30.21, lon: 74.9459 },
  { name: "Patiala", state: "PB", lat: 30.3398, lon: 76.3869 },
  { name: "Delhi", state: "DL", lat: 28.6139, lon: 77.209 },
  { name: "New Delhi", state: "DL", lat: 28.6139, lon: 77.209 },
  { name: "Gurugram", state: "HR", lat: 28.4595, lon: 77.0266 },
  { name: "Noida", state: "UP", lat: 28.5355, lon: 77.391 },
  { name: "Faridabad", state: "HR", lat: 28.4089, lon: 77.3178 },
  { name: "Dehradun", state: "UK", lat: 30.3165, lon: 78.0322 },
  { name: "Haldwani", state: "UK", lat: 29.2183, lon: 79.513 },
  { name: "Jaipur", state: "RJ", lat: 26.9124, lon: 75.7873 },
  { name: "Jodhpur", state: "RJ", lat: 26.2389, lon: 73.0243 },
  { name: "Agra", state: "UP", lat: 27.1767, lon: 78.0081 },
  { name: "Kanpur", state: "UP", lat: 26.4499, lon: 80.3319 },
  { name: "Lucknow", state: "UP", lat: 26.8467, lon: 80.9462 },
  { name: "Varanasi", state: "UP", lat: 25.3176, lon: 82.9739 },
  { name: "Ludhiana", state: "PB", lat: 30.901, lon: 75.8573 },
  { name: "Ahmedabad", state: "GJ", lat: 23.0225, lon: 72.5714 },
  { name: "Surat", state: "GJ", lat: 21.1702, lon: 72.8311 },
  { name: "Vadodara", state: "GJ", lat: 22.3072, lon: 73.1812 },
  { name: "Rajkot", state: "GJ", lat: 22.3039, lon: 70.8022 },
  { name: "Mumbai", state: "MH", lat: 19.076, lon: 72.8777 },
  { name: "Pune", state: "MH", lat: 18.5204, lon: 73.8567 },
  { name: "Nagpur", state: "MH", lat: 21.1458, lon: 79.0882 },
  { name: "Nashik", state: "MH", lat: 19.9975, lon: 73.7898 },
  { name: "Indore", state: "MP", lat: 22.7196, lon: 75.8577 },
  { name: "Bhopal", state: "MP", lat: 23.2599, lon: 77.4126 },
  { name: "Kolkata", state: "WB", lat: 22.5726, lon: 88.3639 },
  { name: "Guwahati", state: "AS", lat: 26.1445, lon: 91.7362 },
  { name: "Patna", state: "BR", lat: 25.5941, lon: 85.1376 },
  { name: "Ranchi", state: "JH", lat: 23.3441, lon: 85.3096 },
  { name: "Bhubaneswar", state: "OD", lat: 20.2961, lon: 85.8245 },
  { name: "Raipur", state: "CG", lat: 21.2514, lon: 81.6296 },
  { name: "Hyderabad", state: "TS", lat: 17.385, lon: 78.4867 },
  { name: "Visakhapatnam", state: "AP", lat: 17.6868, lon: 83.2185 },
  { name: "Chennai", state: "TN", lat: 13.0827, lon: 80.2707 },
  { name: "Coimbatore", state: "TN", lat: 11.0168, lon: 76.9558 },
  { name: "Bengaluru", state: "KA", lat: 12.9716, lon: 77.5946 },
  { name: "Mysuru", state: "KA", lat: 12.2958, lon: 76.6394 },
  { name: "Kochi", state: "KL", lat: 9.9312, lon: 76.2673 },
  { name: "Thiruvananthapuram", state: "KL", lat: 8.5241, lon: 76.9366 },
];

/** Number of gazetteer entries, used in error copy. */
export const OFFLINE_GAZETTEER_SIZE = GAZETTEER.length;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COORDINATE_PATTERN = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+))?\s*$/;

/**
 * Lets a user bypass geocoding entirely by entering "30.7333, 76.7794". Always
 * available - these are real coordinates the operator supplied, not invented ones.
 */
export function parseCoordinateInput(place: string): { lat: number; lon: number } | null {
  const match = COORDINATE_PATTERN.exec(place);
  if (!match) return null;

  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;

  return { lat, lon };
}

export type OfflineGeocodeResult = {
  lat: number;
  lon: number;
  displayName: string;
  offline: true;
};

/** Longest gazetteer name contained in the query wins, so "Fort Worth" beats "Worth". */
export function offlineGeocode(place: string): OfflineGeocodeResult | null {
  if (!offlineFallbackEnabled()) return null;

  const query = normalize(place);
  if (query.length < 2) return null;

  let best: GazetteerEntry | null = null;
  let bestLength = 0;
  for (const entry of GAZETTEER) {
    const name = normalize(entry.name);
    if (name.length > bestLength && (query.startsWith(name) || query.includes(` ${name} `) || query.includes(`${name} `))) {
      best = entry;
      bestLength = name.length;
    }
  }
  if (!best) return null;

  return {
    lat: best.lat,
    lon: best.lon,
    displayName: `${best.name}, ${best.state} (offline gazetteer)`,
    offline: true,
  };
}

/** Mirrors the subset of the OSRM response shape the analysis pipeline consumes. */
export type OfflineRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
};

const AVERAGE_TRACK_MPH = 62;
const METERS_PER_SECOND_AT_62MPH = AVERAGE_TRACK_MPH * 1609.344 / 3600;
const SAMPLE_POINTS = 26;
/**
 * Perpendicular detour offsets as a fraction of corridor length, not fixed degrees:
 * a constant 0.9 deg is a credible truck detour over 700 miles but a 35% distance
 * inflation on a 140-mile hop. Clamped so long corridors don't wander off-continent.
 */
const BOW_FRACTIONS = [0, 0.075, -0.065];
const MAX_BOW_DEGREES = 1.2;

function buildCorridor(origin: Coordinate, destination: Coordinate, bowFraction: number): Coordinate[] {
  const dLat = destination.lat - origin.lat;
  const dLon = destination.lon - origin.lon;
  const magnitude = Math.hypot(dLat, dLon) || 1;
  const bow = Math.max(-MAX_BOW_DEGREES, Math.min(MAX_BOW_DEGREES, magnitude * bowFraction));
  const normalLat = -dLon / magnitude;
  const normalLon = dLat / magnitude;

  const points: Coordinate[] = [];
  for (let i = 0; i <= SAMPLE_POINTS; i += 1) {
    const t = i / SAMPLE_POINTS;
    const base = interpolateCoordinate(origin, destination, t);
    const offset = Math.sin(t * Math.PI) * bow;
    points.push({ lat: base.lat + normalLat * offset, lon: base.lon + normalLon * offset });
  }
  return points;
}

/** Three plausible corridors between two points when the routing provider is down. */
export function offlineRoutes(origin: Coordinate, destination: Coordinate): OfflineRoute[] | null {
  if (!offlineFallbackEnabled()) return null;
  if (Math.hypot(destination.lat - origin.lat, destination.lon - origin.lon) < 0.05) return null;

  return BOW_FRACTIONS.map((bowFraction) => {
    const geometry = buildCorridor(origin, destination, bowFraction);
    const distance = getPolylineDistanceMeters(geometry);
    return {
      distance,
      duration: distance / METERS_PER_SECOND_AT_62MPH,
      geometry: { coordinates: geometry.map((p) => [p.lon, p.lat] as [number, number]) },
    };
  });
}
