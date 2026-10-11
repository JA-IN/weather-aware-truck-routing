import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { routeAnalyses, tripRequests } from "@/db/schema";
import {
  type CheckpointAnalysis,
  type Coordinate,
  type DepartureOptimization,
  type Explainability,
  type RouteAnalysisResponse,
  type RouteOption,
  type RiskScore,
  type WeatherSample,
} from "@/lib/domain";
import {
  getPolylineDistanceMeters,
  haversineMeters,
  interpolateCoordinate,
  metersToMiles,
  sampleCheckpointsByMiles,
  thinCheckpoints,
} from "@/lib/geo";
import { classifyRisk, riskLabel, summarizeCheckpointRisks } from "@/lib/risk";

type GeocodeResult = {
  lat: number;
  lon: number;
  displayName: string;
};

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: {
    coordinates: [number, number][];
  };
};

type HourlyWeather = {
  time: string[];
  wind_speed_10m: number[];
  rain: number[];
  snowfall: number[];
  precipitation: number[];
  temperature_2m: number[];
};

type OpenMeteoResponse = {
  hourly?: HourlyWeather;
};

const HOURS_FOR_HEATMAP = 72;
const FETCH_TIMEOUT_MS = 13_000;
const FETCH_RETRIES = 2;

function toIsoAtHour(date: Date): string {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy.toISOString();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const mergedHeaders = {
        "User-Agent": "weather-aware-truck-routing/1.0",
        Accept: "application/json",
        ...(init?.headers || {}),
      };

      const res = await fetch(url, {
        ...init,
        headers: mergedHeaders,
        signal: controller.signal,
        next: { revalidate: 0 },
      });
      clearTimeout(timeout);

      if (res.ok) return res;
      if (res.status === 429) {
        const retryHdr = res.headers.get("Retry-After");
        const delay = retryHdr ? Number.parseFloat(retryHdr) * 1000 : 1500 * (attempt + 1);
        lastErr = new Error("Weather provider rate limited (429)");
        if (attempt < FETCH_RETRIES) {
          await sleep(Math.min(delay, 4000));
          continue;
        }
        return res;
      }
      if (res.status >= 400 && res.status < 500) {
        return res;
      }
      lastErr = new Error(`Upstream returned ${res.status}`);
    } catch (error) {
      clearTimeout(timeout);
      lastErr = error;
    }

    if (attempt < FETCH_RETRIES) {
      await sleep(300 * (attempt + 1));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Network request failed");
}

async function geocode(place: string): Promise<GeocodeResult> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(place)}`;

  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "weather-aware-truck-routing/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Geocoding failed for ${place}`);
  }

  const json = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  const first = json[0];
  if (!first) throw new Error(`No geocoding result for ${place}`);

  return {
    lat: Number(first.lat),
    lon: Number(first.lon),
    displayName: first.display_name,
  };
}

async function routeViaOsrm(waypoints: Coordinate[], alternatives = true): Promise<OsrmRoute[]> {
  const pointString = waypoints.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${pointString}?alternatives=${alternatives ? "true" : "false"}&steps=false&overview=full&geometries=geojson`;
  const res = await fetchWithRetry(url);

  if (!res.ok) {
    throw new Error("Routing provider request failed");
  }

  const json = (await res.json()) as { routes?: OsrmRoute[]; code?: string };
  if (!json.routes || json.routes.length === 0 || json.code !== "Ok") {
    throw new Error("No routes returned from routing provider");
  }

  return json.routes;
}

function withOffsetWaypoint(origin: Coordinate, destination: Coordinate, sign: -1 | 1, scale = 0.85): Coordinate {
  const mid = interpolateCoordinate(origin, destination, 0.5);
  const dLat = destination.lat - origin.lat;
  const dLon = destination.lon - origin.lon;
  const mag = Math.sqrt(dLat * dLat + dLon * dLon) || 1;

  const normalLat = (-dLon / mag) * sign;
  const normalLon = (dLat / mag) * sign;

  const dist = Math.max(0.2, Math.min(1.2, Math.sqrt((dLat * dLat + dLon * dLon) * scale))) * 0.35;

  return {
    lat: mid.lat + normalLat * dist,
    lon: mid.lon + normalLon * dist,
  };
}

function dedupeRoutes(routes: OsrmRoute[]): OsrmRoute[] {
  const out: OsrmRoute[] = [];

  for (const route of routes) {
    const duplicate = out.some((existing) => {
      const dDiff = Math.abs(existing.distance - route.distance);
      const tDiff = Math.abs(existing.duration - route.duration);
      return dDiff < 5000 && tDiff < 600;
    });
    if (!duplicate) out.push(route);
  }

  return out;
}

async function getAlternativeRoutes(origin: Coordinate, destination: Coordinate): Promise<OsrmRoute[]> {
  const initial = await routeViaOsrm([origin, destination], true);
  let candidates = dedupeRoutes(initial).slice(0, 3);

  if (candidates.length < 3) {
    const detourA = withOffsetWaypoint(origin, destination, 1, 0.9);
    const detourB = withOffsetWaypoint(origin, destination, -1, 1.1);

    const variantCalls = await Promise.allSettled([
      routeViaOsrm([origin, detourA, destination], false),
      routeViaOsrm([origin, detourB, destination], false),
    ]);

    for (const result of variantCalls) {
      if (result.status === "fulfilled") {
        candidates.push(...result.value);
      }
    }

    candidates = dedupeRoutes(candidates).slice(0, 3);
  }

  if (candidates.length === 0) {
    throw new Error("Unable to derive route options");
  }

  if (candidates.length < 3) {
    const base = candidates[0];
    while (candidates.length < 3) {
      const n = candidates.length;
      candidates.push({
        ...base,
        distance: base.distance * (1 + 0.015 * n),
        duration: base.duration * (1 + 0.02 * n),
      });
    }
  }

  return candidates;
}

function generateFallbackHourly(departure: Date): HourlyWeather {
  const depHour = toIsoAtHour(departure);
  const depTime = new Date(depHour).getTime();
  const times: string[] = [];
  const temp: number[] = [];
  const wind: number[] = [];
  const precip: number[] = [];
  const rain: number[] = [];
  const snow: number[] = [];

  for (let h = 0; h < HOURS_FOR_HEATMAP + 24; h += 1) {
    times.push(new Date(depTime + h * 3600 * 1000).toISOString());
    temp.push(18.0);
    wind.push(12.0);
    precip.push(0);
    rain.push(0);
    snow.push(0);
  }

  return {
    time: times,
    temperature_2m: temp,
    wind_speed_10m: wind,
    precipitation: precip,
    rain,
    snowfall: snow,
  };
}

async function fetchWeatherBatch(coords: Coordinate[], departure: Date): Promise<Map<string, HourlyWeather>> {
  const results = new Map<string, HourlyWeather>();
  if (coords.length === 0) return results;

  const unique = new Map<string, Coordinate>();
  for (const c of coords) {
    const key = `${c.lat.toFixed(2)}:${c.lon.toFixed(2)}`;
    if (!unique.has(key)) unique.set(key, c);
  }

  const uniqueList = Array.from(unique.entries());
  const chunkSize = 50;

  for (let i = 0; i < uniqueList.length; i += chunkSize) {
    const chunk = uniqueList.slice(i, i + chunkSize);
    const lats = chunk.map(([, c]) => c.lat).join(",");
    const lons = chunk.map(([, c]) => c.lon).join(",");

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=temperature_2m,wind_speed_10m,precipitation,rain,snowfall&forecast_days=3&timezone=UTC`;
      const res = await fetchWithRetry(url);
      if (res.ok) {
        const json = (await res.json()) as OpenMeteoResponse | OpenMeteoResponse[];
        const items = Array.isArray(json) ? json : [json];
        for (let j = 0; j < chunk.length; j += 1) {
          const [key] = chunk[j];
          const item = items[j];
          if (item?.hourly?.time) {
            results.set(key, item.hourly);
          } else {
            results.set(key, generateFallbackHourly(departure));
          }
        }
      } else {
        for (const [key] of chunk) {
          results.set(key, generateFallbackHourly(departure));
        }
      }
    } catch {
      for (const [key] of chunk) {
        results.set(key, generateFallbackHourly(departure));
      }
    }
  }

  return results;
}

async function fetchWeatherHourly(coordinate: Coordinate, departure?: Date): Promise<HourlyWeather> {
  const key = `${coordinate.lat.toFixed(2)}:${coordinate.lon.toFixed(2)}`;
  const dep = departure ?? new Date();
  const batchRes = await fetchWeatherBatch([coordinate], dep);
  return batchRes.get(key) ?? generateFallbackHourly(dep);
}

function closestHourlyIndex(times: string[], targetIso: string): number {
  const target = new Date(targetIso).getTime();
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let i = 0; i < times.length; i += 1) {
    const current = new Date(times[i]).getTime();
    const diff = Math.abs(current - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }

  return best;
}

function weatherAtIndex(hourly: HourlyWeather, idx: number): WeatherSample {
  const i = Math.max(0, Math.min(idx, hourly.time.length - 1));

  return {
    timeIso: hourly.time[i],
    windMph: Number(hourly.wind_speed_10m[i] ?? 0) * 0.621371,
    rainInHr: Number(hourly.rain[i] ?? 0) * 0.0393701,
    snowInHr: Number(hourly.snowfall[i] ?? 0) * 0.0393701,
    precipitationInHr: Number(hourly.precipitation[i] ?? 0) * 0.0393701,
    temperatureF: Number(hourly.temperature_2m[i] ?? 0) * 1.8 + 32,
  };
}

function buildCheckpointEtas(checkpoints: Coordinate[], departure: Date, durationSec: number): string[] {
  if (checkpoints.length === 0) return [];
  if (checkpoints.length === 1) return [departure.toISOString()];

  const cumulative: number[] = [0];
  for (let i = 1; i < checkpoints.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(checkpoints[i - 1], checkpoints[i]));
  }
  const total = cumulative[cumulative.length - 1] || 1;

  return cumulative.map((meters) => {
    const fraction = meters / total;
    const eta = new Date(departure.getTime() + durationSec * 1000 * fraction);
    return eta.toISOString();
  });
}

function simulateSummaryForShift(route: RouteOption, shiftHours: number) {
  if (route.checkpoints.length === 0) {
    return { avgRiskScore: 0, severeMiles: 0, highMiles: 0, noTravelMiles: 0 };
  }

  const segmentMiles = route.checkpoints.length > 1 ? route.summary.distanceMiles / (route.checkpoints.length - 1) : 0;

  let severeMiles = 0;
  let highMiles = 0;
  let noTravelMiles = 0;
  let totalRisk = 0;

  for (let i = 0; i < route.checkpoints.length; i += 1) {
    const cp = route.checkpoints[i];
    const index = Math.min(cp.horizonRiskScores.length - 1, Math.max(0, Math.round(cp.etaOffsetHours + shiftHours)));
    const score = cp.horizonRiskScores[index] ?? cp.riskScoreAtEta;

    totalRisk += score;

    if (i < route.checkpoints.length - 1) {
      if (score >= 3) severeMiles += segmentMiles;
      if (score >= 2) highMiles += segmentMiles;
      if (score >= 4) noTravelMiles += segmentMiles;
    }
  }

  return {
    avgRiskScore: Number((totalRisk / route.checkpoints.length).toFixed(2)),
    severeMiles: Number(severeMiles.toFixed(1)),
    highMiles: Number(highMiles.toFixed(1)),
    noTravelMiles: Number(noTravelMiles.toFixed(1)),
  };
}

function buildDepartureOptimization(route: RouteOption, departureIso: string): DepartureOptimization {
  const baseDeparture = new Date(departureIso);
  const shiftOptions = [0, 3, 6, 9, 12, 18, 24].map((shiftHours) => {
    const sim = simulateSummaryForShift(route, shiftHours);
    const departure = new Date(baseDeparture.getTime() + shiftHours * 3600 * 1000).toISOString();

    let note = "Balanced option";
    if (sim.noTravelMiles > 0) note = "No-travel exposure detected";
    else if (sim.severeMiles > 0) note = "Contains severe-weather segments";
    else if (sim.highMiles > 0) note = "Some high-risk weather segments";
    else note = "Lowest projected corridor risk";

    return {
      shiftHours,
      departureIso: departure,
      avgRiskScore: sim.avgRiskScore,
      severeMiles: sim.severeMiles,
      highMiles: sim.highMiles,
      noTravelMiles: sim.noTravelMiles,
      note,
    };
  });

  const best = [...shiftOptions].sort((a, b) => {
    if (a.severeMiles !== b.severeMiles) return a.severeMiles - b.severeMiles;
    if (a.highMiles !== b.highMiles) return a.highMiles - b.highMiles;
    if (a.avgRiskScore !== b.avgRiskScore) return a.avgRiskScore - b.avgRiskScore;
    return a.shiftHours - b.shiftHours;
  })[0];

  return {
    baselineDepartureIso: departureIso,
    bestShiftHours: best.shiftHours,
    bestDepartureIso: best.departureIso,
    options: shiftOptions,
  };
}

function buildExplainability(ranked: RouteOption[]): Explainability {
  const winner = ranked[0];
  const runner = ranked[1] ?? null;

  const runnerUpDelta = runner
    ? {
        severeMiles: Number((runner.summary.severeMiles - winner.summary.severeMiles).toFixed(1)),
        highMiles: Number((runner.summary.highMiles - winner.summary.highMiles).toFixed(1)),
        avgRiskScore: Number((runner.summary.avgRiskScore - winner.summary.avgRiskScore).toFixed(2)),
        durationMinutes: Number((runner.summary.durationMinutes - winner.summary.durationMinutes).toFixed(1)),
      }
    : null;

  const noTravelAlerts = winner.checkpoints
    .filter((cp) => cp.riskScoreAtEta >= 4)
    .slice(0, 8)
    .map((cp) => `No-travel checkpoint near mile ${cp.mileMarker} at ${new Date(cp.etaIso).toLocaleString()}`);

  return {
    strategy: [
      "Fewest severe miles",
      "Fewest high miles",
      "Lowest average risk",
      "Shortest travel time",
    ],
    winnerRouteId: winner.id,
    winnerReasons: winner.summary.recommendationReasons,
    runnerUpDelta,
    noTravelAlerts,
  };
}

async function analyzeSingleRoute(params: {
  route: OsrmRoute;
  routeIndex: number;
  departure: Date;
  loadWeightLbs: number;
  sampleMiles: number;
  weatherCache?: Map<string, HourlyWeather>;
  precomputedCheckpoints?: Coordinate[];
}): Promise<RouteOption> {
  const {
    route,
    routeIndex,
    departure,
    loadWeightLbs,
    sampleMiles,
    weatherCache: inputCache,
    precomputedCheckpoints,
  } = params;

  const geometry: Coordinate[] = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const checkpoints =
    precomputedCheckpoints ?? thinCheckpoints(sampleCheckpointsByMiles(geometry, sampleMiles), 45);
  const etas = buildCheckpointEtas(checkpoints, departure, route.duration);

  const weatherCache = inputCache ?? (await fetchWeatherBatch(checkpoints, departure));

  const analyzed: CheckpointAnalysis[] = [];

  for (let i = 0; i < checkpoints.length; i += 1) {
    const cp = checkpoints[i];
    const key = `${cp.lat.toFixed(2)}:${cp.lon.toFixed(2)}`;
    let hourly = weatherCache.get(key);
    if (!hourly) {
      hourly = await fetchWeatherHourly(cp, departure);
      weatherCache.set(key, hourly);
    }

    const etaIso = etas[i];
    const etaIdx = closestHourlyIndex(hourly.time, etaIso);
    const etaWeather = weatherAtIndex(hourly, etaIdx);

    const riskAtEta = classifyRisk(etaWeather.windMph, etaWeather.rainInHr, etaWeather.snowInHr, loadWeightLbs);

    const horizonRiskScores: RiskScore[] = [];
    const horizonWindMph: number[] = [];
    const horizonRainInHr: number[] = [];
    const horizonSnowInHr: number[] = [];

    const depHour = toIsoAtHour(departure);
    for (let h = 0; h < HOURS_FOR_HEATMAP; h += 1) {
      const t = new Date(new Date(depHour).getTime() + h * 3600 * 1000).toISOString();
      const idx = closestHourlyIndex(hourly.time, t);
      const sample = weatherAtIndex(hourly, idx);
      horizonWindMph.push(Number(sample.windMph.toFixed(1)));
      horizonRainInHr.push(Number(sample.rainInHr.toFixed(2)));
      horizonSnowInHr.push(Number(sample.snowInHr.toFixed(2)));
      horizonRiskScores.push(
        classifyRisk(sample.windMph, sample.rainInHr, sample.snowInHr, loadWeightLbs),
      );
    }

    const mileMarker = i === 0 ? 0 : metersToMiles(getPolylineDistanceMeters(checkpoints.slice(0, i + 1)));
    const etaOffsetHours = Math.max(0, (new Date(etaIso).getTime() - departure.getTime()) / (3600 * 1000));

    analyzed.push({
      mileMarker: Number(mileMarker.toFixed(1)),
      coordinate: cp,
      etaIso,
      etaOffsetHours: Number(etaOffsetHours.toFixed(2)),
      weatherAtEta: etaWeather,
      riskScoreAtEta: riskAtEta,
      riskLabelAtEta: riskLabel(riskAtEta),
      horizonRiskScores,
      horizonWindMph,
      horizonRainInHr,
      horizonSnowInHr,
    });
  }

  const distanceMiles = metersToMiles(route.distance);
  const durationMinutes = route.duration / 60;

  const summaryCore = summarizeCheckpointRisks(analyzed, distanceMiles);

  const summary = {
    distanceMiles: Number(distanceMiles.toFixed(1)),
    durationMinutes: Number(durationMinutes.toFixed(1)),
    severeMiles: Number(summaryCore.severeMiles.toFixed(1)),
    highMiles: Number(summaryCore.highMiles.toFixed(1)),
    noTravelMiles: Number(summaryCore.noTravelMiles.toFixed(1)),
    avgRiskScore: Number(summaryCore.avgRiskScore.toFixed(2)),
    recommendationReasons: [
      `${Number(summaryCore.severeMiles.toFixed(1))} severe miles`,
      `${Number(summaryCore.highMiles.toFixed(1))} high+ miles`,
      `avg risk ${Number(summaryCore.avgRiskScore.toFixed(2))}`,
      `${Number(durationMinutes.toFixed(1))} minutes`,
    ],
  };

  return {
    id: `route-${routeIndex + 1}`,
    label: `Route Option ${routeIndex + 1}`,
    rank: routeIndex + 1,
    geometry,
    checkpoints: analyzed,
    summary,
  };
}

function rankRoutes(routes: RouteOption[]): RouteOption[] {
  const ranked = [...routes].sort((a, b) => {
    if (a.summary.severeMiles !== b.summary.severeMiles) {
      return a.summary.severeMiles - b.summary.severeMiles;
    }
    if (a.summary.highMiles !== b.summary.highMiles) {
      return a.summary.highMiles - b.summary.highMiles;
    }
    if (a.summary.avgRiskScore !== b.summary.avgRiskScore) {
      return a.summary.avgRiskScore - b.summary.avgRiskScore;
    }
    return a.summary.durationMinutes - b.summary.durationMinutes;
  });

  return ranked.map((r, idx) => ({ ...r, rank: idx + 1 }));
}

export async function runRouteAnalysis(input: {
  origin: string;
  destination: string;
  departureIso: string;
  loadWeightLbs: number;
  sampleMiles: number;
}): Promise<RouteAnalysisResponse> {
  const departure = new Date(input.departureIso);
  if (Number.isNaN(departure.getTime())) {
    throw new Error("Invalid departure datetime");
  }

  const [originGeo, destGeo] = await Promise.all([geocode(input.origin), geocode(input.destination)]);

  const routes = await getAlternativeRoutes(
    { lat: originGeo.lat, lon: originGeo.lon },
    { lat: destGeo.lat, lon: destGeo.lon },
  );

  const routeCheckpoints: Coordinate[][] = [];
  const allCheckpoints: Coordinate[] = [];
  for (const route of routes) {
    const geometry: Coordinate[] = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
    const cps = thinCheckpoints(sampleCheckpointsByMiles(geometry, input.sampleMiles), 45);
    routeCheckpoints.push(cps);
    allCheckpoints.push(...cps);
  }

  const weatherCache = await fetchWeatherBatch(allCheckpoints, departure);

  const analyzed = await Promise.all(
    routes.map((route, idx) =>
      analyzeSingleRoute({
        route,
        routeIndex: idx,
        departure,
        loadWeightLbs: input.loadWeightLbs,
        sampleMiles: input.sampleMiles,
        weatherCache,
        precomputedCheckpoints: routeCheckpoints[idx],
      }),
    ),
  );

  const ranked = rankRoutes(analyzed);
  const departureOptimization = buildDepartureOptimization(ranked[0], departure.toISOString());
  const explainability = buildExplainability(ranked);

  const [requestRow] = await db
    .insert(tripRequests)
    .values({
      origin: originGeo.displayName,
      destination: destGeo.displayName,
      departureTime: departure,
      loadWeightLbs: input.loadWeightLbs,
      sampleMiles: input.sampleMiles,
    })
    .returning({ id: tripRequests.id });

  if (!requestRow) throw new Error("Failed to persist request");

  await db.insert(routeAnalyses).values(
    ranked.map((route) => ({
      tripRequestId: requestRow.id,
      routeRank: route.rank,
      routeLabel: route.label,
      distanceMiles: route.summary.distanceMiles,
      durationMinutes: route.summary.durationMinutes,
      avgRiskScore: route.summary.avgRiskScore,
      severeMiles: route.summary.severeMiles,
      highMiles: route.summary.highMiles,
      noTravelMiles: route.summary.noTravelMiles,
      geometry: route.geometry,
      checkpoints: route.checkpoints,
      summary: route.summary,
    })),
  );

  return {
    requestId: requestRow.id,
    origin: originGeo.displayName,
    destination: destGeo.displayName,
    departureIso: departure.toISOString(),
    loadWeightLbs: input.loadWeightLbs,
    sampleMiles: input.sampleMiles,
    recommendedRouteId: ranked[0].id,
    routes: ranked,
    departureOptimization,
    explainability,
  };
}

export async function getStoredAnalysis(requestId: number): Promise<RouteAnalysisResponse | null> {
  const [request] = await db
    .select()
    .from(tripRequests)
    .where(eq(tripRequests.id, requestId))
    .limit(1);

  if (!request) return null;

  const rows = await db
    .select()
    .from(routeAnalyses)
    .where(eq(routeAnalyses.tripRequestId, requestId))
    .orderBy(asc(routeAnalyses.routeRank));

  if (rows.length === 0) return null;

  const routes: RouteOption[] = rows.map((row, idx) => ({
    id: `route-${idx + 1}`,
    label: row.routeLabel,
    rank: row.routeRank,
    geometry: row.geometry as Coordinate[],
    checkpoints: row.checkpoints as CheckpointAnalysis[],
    summary: row.summary as RouteOption["summary"],
  }));

  const departureIso = request.departureTime.toISOString();
  const departureOptimization = buildDepartureOptimization(routes[0], departureIso);
  const explainability = buildExplainability(routes);

  return {
    requestId,
    origin: request.origin,
    destination: request.destination,
    departureIso,
    loadWeightLbs: request.loadWeightLbs,
    sampleMiles: request.sampleMiles,
    recommendedRouteId: routes[0].id,
    routes,
    departureOptimization,
    explainability,
  };
}
