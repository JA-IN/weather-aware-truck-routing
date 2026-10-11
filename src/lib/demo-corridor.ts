import {
  RISK_LABELS,
  type CheckpointAnalysis,
  type Coordinate,
  type DepartureOptimization,
  type Explainability,
  type RiskScore,
  type RouteAnalysisResponse,
  type RouteOption,
} from "@/lib/domain";
import { classifyRisk } from "@/lib/risk";

/**
 * Synthetic Dallas -> Denver corridor used for offline demos, Storybook-style
 * previews and E2E runs where Nominatim/OSRM/Open-Meteo and Postgres are not
 * reachable. Same shapes as POST /api/route-analysis, so every surface
 * (map, risk strip, timeline table, optimizer, explainability) renders as-is.
 */
const DEPARTURE = new Date("2026-10-11T18:00:00.000Z");
const LOAD_LBS = 36_000;
const SAMPLE_MILES = 25;
const MILES_PER_DEG_LAT = 69;

const SPINE: Coordinate[] = [
  { lat: 32.7767, lon: -96.797 },
  { lat: 34.15, lon: -97.05 },
  { lat: 35.15, lon: -97.55 },
  { lat: 36.06, lon: -95.86 },
  { lat: 36.73, lon: -94.32 },
  { lat: 37.22, lon: -93.29 },
  { lat: 38.25, lon: -91.77 },
  { lat: 38.63, lon: -90.2 },
  { lat: 38.85, lon: -87.6 },
];

const LABELS = ["Fastest corridor (I-44 spine)", "Northern detour", "Southern detour"];
const BOW = [0, 0.35, -0.3];
const SPEED_FACTOR = [1, 1.06, 0.97];

function milesBetween(a: Coordinate, b: Coordinate): number {
  const dLat = (b.lat - a.lat) * MILES_PER_DEG_LAT;
  const dLon = (b.lon - a.lon) * MILES_PER_DEG_LAT * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function polylineMiles(points: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += milesBetween(points[i - 1], points[i]);
  return total;
}

/** A storm band crossing the corridor: wind/precip peak mid-run, snow near the Rockies. */
function weatherAt(progress: number, hourOffset: number, seed: number) {
  const band = Math.exp(-((progress - 0.55 - hourOffset / 400) ** 2) / 0.02);
  const night = Math.sin(((hourOffset + progress * 24 + seed) / 6) * Math.PI) * 4;
  return {
    windMph: Number(Math.max(4, 12 + band * 48 + night).toFixed(1)),
    rainInHr: Number(Math.max(0, band * 0.85 + Math.sin((hourOffset + seed) / 5) * 0.06).toFixed(2)),
    snowInHr: progress > 0.78 ? Number(Math.max(0, band * 1.9).toFixed(2)) : 0,
    temperatureF: Math.round(78 - progress * 22 + night * 0.8 - band * 6),
  };
}

function buildRoute(index: number): RouteOption {
  const bow = BOW[index] ?? 0;
  const speedFactor = SPEED_FACTOR[index] ?? 1;

  const geometry: Coordinate[] = SPINE.map((p, i) => {
    const t = i / (SPINE.length - 1);
    const offset = Math.sin(t * Math.PI) * bow;
    return { lat: p.lat + offset * 0.45, lon: p.lon + offset * 0.25 };
  });

  const distanceMiles = Number((polylineMiles(geometry) * (1 + Math.abs(bow) * 0.09)).toFixed(1));
  const durationMinutes = Number(((distanceMiles / 62) * 60 * speedFactor).toFixed(1));
  const count = Math.max(2, Math.round(distanceMiles / SAMPLE_MILES));

  const checkpoints: CheckpointAnalysis[] = [];
  for (let i = 0; i <= count; i += 1) {
    const progress = i / count;
    const anchorIndex = Math.min(geometry.length - 2, Math.floor(progress * (geometry.length - 1)));
    const from = geometry[anchorIndex];
    const to = geometry[anchorIndex + 1];
    const localT = progress * (geometry.length - 1) - anchorIndex;
    const coordinate: Coordinate = {
      lat: from.lat + (to.lat - from.lat) * localT,
      lon: from.lon + (to.lon - from.lon) * localT,
    };

    const etaOffsetHours = Number((progress * (durationMinutes / 60)).toFixed(2));
    const etaIso = new Date(DEPARTURE.getTime() + etaOffsetHours * 3_600_000).toISOString();

    const atEta = weatherAt(progress, etaOffsetHours, index * 7);
    const riskScoreAtEta = classifyRisk(atEta.windMph, atEta.rainInHr, atEta.snowInHr, LOAD_LBS);

    const horizonRiskScores: RiskScore[] = [];
    const horizonWindMph: number[] = [];
    const horizonRainInHr: number[] = [];
    const horizonSnowInHr: number[] = [];
    for (let h = 0; h < 72; h += 1) {
      const sample = weatherAt(progress, h + etaOffsetHours * 0.2, index * 7);
      horizonWindMph.push(sample.windMph);
      horizonRainInHr.push(sample.rainInHr);
      horizonSnowInHr.push(sample.snowInHr);
      horizonRiskScores.push(classifyRisk(sample.windMph, sample.rainInHr, sample.snowInHr, LOAD_LBS));
    }

    checkpoints.push({
      mileMarker: Number((progress * distanceMiles).toFixed(1)),
      coordinate,
      etaIso,
      etaOffsetHours,
      weatherAtEta: {
        timeIso: etaIso,
        windMph: atEta.windMph,
        rainInHr: atEta.rainInHr,
        snowInHr: atEta.snowInHr,
        precipitationInHr: Number((atEta.rainInHr + atEta.snowInHr).toFixed(2)),
        temperatureF: atEta.temperatureF,
      },
      riskScoreAtEta,
      riskLabelAtEta: RISK_LABELS[riskScoreAtEta],
      horizonRiskScores,
      horizonWindMph,
      horizonRainInHr,
      horizonSnowInHr,
    });
  }

  const segment = distanceMiles / Math.max(1, checkpoints.length - 1);
  let severeMiles = 0;
  let highMiles = 0;
  let noTravelMiles = 0;
  for (let i = 0; i < checkpoints.length - 1; i += 1) {
    const score = checkpoints[i].riskScoreAtEta;
    if (score >= 3) severeMiles += segment;
    if (score >= 2) highMiles += segment;
    if (score >= 4) noTravelMiles += segment;
  }
  const avgRiskScore = checkpoints.reduce((acc, cp) => acc + cp.riskScoreAtEta, 0) / checkpoints.length;

  return {
    id: `sample-route-${index + 1}`,
    label: LABELS[index] ?? `Route Option ${index + 1}`,
    rank: index + 1,
    geometry,
    checkpoints,
    summary: {
      distanceMiles,
      durationMinutes,
      severeMiles: Number(severeMiles.toFixed(1)),
      highMiles: Number(highMiles.toFixed(1)),
      noTravelMiles: Number(noTravelMiles.toFixed(1)),
      avgRiskScore: Number(avgRiskScore.toFixed(2)),
      recommendationReasons: [
        `${Number(severeMiles.toFixed(1))} severe miles`,
        `${Number(highMiles.toFixed(1))} high+ miles`,
        `avg risk ${Number(avgRiskScore.toFixed(2))}`,
        `${durationMinutes} minutes`,
      ],
    },
  };
}

/** Same prioritization as the live backend: severe -> high -> avg risk -> duration. */
function rankRoutes(routes: RouteOption[]): RouteOption[] {
  const ranked = [...routes].sort((a, b) => {
    if (a.summary.severeMiles !== b.summary.severeMiles) return a.summary.severeMiles - b.summary.severeMiles;
    if (a.summary.highMiles !== b.summary.highMiles) return a.summary.highMiles - b.summary.highMiles;
    if (a.summary.avgRiskScore !== b.summary.avgRiskScore) return a.summary.avgRiskScore - b.summary.avgRiskScore;
    return a.summary.durationMinutes - b.summary.durationMinutes;
  });
  return ranked.map((r, idx) => ({ ...r, rank: idx + 1 }));
}

export function buildSampleAnalysis(): RouteAnalysisResponse {
  const routes = rankRoutes([0, 1, 2].map(buildRoute));
  const winner = routes[0];
  const runner = routes[1] ?? null;

  const shifts = [-6, -3, 0, 3, 6, 9];
  const options = shifts.map((shiftHours) => {
    const departureIso = new Date(DEPARTURE.getTime() + shiftHours * 3_600_000).toISOString();
    const scores: number[] = winner.checkpoints.map((cp) => {
      const shiftedHour = Math.max(0, Math.min(71, Math.round(cp.etaOffsetHours - shiftHours)));
      return classifyRisk(
        cp.horizonWindMph[shiftedHour] ?? cp.weatherAtEta.windMph,
        cp.horizonRainInHr[shiftedHour] ?? cp.weatherAtEta.rainInHr,
        cp.horizonSnowInHr[shiftedHour] ?? cp.weatherAtEta.snowInHr,
        LOAD_LBS,
      );
    });
    const share = (test: (score: number) => boolean) =>
      (scores.filter(test).length / Math.max(1, scores.length)) * winner.summary.distanceMiles;
    const severeMiles = share((score) => score >= 3);
    const highMiles = share((score) => score >= 2);
    const noTravelMiles = share((score) => score >= 4);
    const avg = scores.reduce((a: number, b: number) => a + b, 0) / Math.max(1, scores.length);

    return {
      shiftHours,
      departureIso,
      avgRiskScore: Number(avg.toFixed(2)),
      severeMiles: Number(severeMiles.toFixed(1)),
      highMiles: Number(highMiles.toFixed(1)),
      noTravelMiles: Number(noTravelMiles.toFixed(1)),
      note:
        shiftHours === 0
          ? "Current departure"
          : shiftHours < 0
            ? `Depart ${Math.abs(shiftHours)}h earlier`
            : `Delay ${shiftHours}h`,
    };
  });

  const best = [...options].sort((a, b) => a.avgRiskScore - b.avgRiskScore)[0];

  const departureOptimization: DepartureOptimization = {
    baselineDepartureIso: DEPARTURE.toISOString(),
    bestShiftHours: best?.shiftHours ?? 0,
    bestDepartureIso: best?.departureIso ?? DEPARTURE.toISOString(),
    options,
  };

  const explainability: Explainability = {
    strategy: ["Fewest severe miles", "Fewest high miles", "Lowest average risk", "Shortest travel time"],
    winnerRouteId: winner.id,
    winnerReasons: winner.summary.recommendationReasons,
    runnerUpDelta: runner
      ? {
          severeMiles: Number((runner.summary.severeMiles - winner.summary.severeMiles).toFixed(1)),
          highMiles: Number((runner.summary.highMiles - winner.summary.highMiles).toFixed(1)),
          avgRiskScore: Number((runner.summary.avgRiskScore - winner.summary.avgRiskScore).toFixed(2)),
          durationMinutes: Number((runner.summary.durationMinutes - winner.summary.durationMinutes).toFixed(1)),
        }
      : null,
    noTravelAlerts: winner.checkpoints
      .filter((cp) => cp.riskScoreAtEta >= 4)
      .slice(0, 8)
      .map((cp) => `No-travel checkpoint near mile ${cp.mileMarker} at ${new Date(cp.etaIso).toLocaleString()}`),
  };

  return {
    requestId: 0,
    origin: "Dallas, TX, United States",
    destination: "Denver, CO, United States",
    departureIso: DEPARTURE.toISOString(),
    loadWeightLbs: LOAD_LBS,
    sampleMiles: SAMPLE_MILES,
    recommendedRouteId: winner.id,
    routes,
    departureOptimization,
    explainability,
  };
}
