import { RISK_COLORS, type CheckpointAnalysis, type RiskScore } from "@/lib/domain";

/**
 * Shared "corridor" math for every weather-layer surface (map markers, the
 * checkpoint risk strip, the checkpoint timeline). Keeping it in one place means
 * a marker dot and its table row can never disagree about the risk at an hour.
 */
export type CorridorLayer = "risk" | "wind" | "precipitation" | "snow" | "closures";

export const CORRIDOR_LAYERS: CorridorLayer[] = ["risk", "wind", "precipitation", "snow", "closures"];

/** Slider bound exposed in the UI (0-48h playback window). */
export const MAX_FORECAST_HOUR = 48;

/** Length of the hourly horizon emitted by both backends. */
export const HORIZON_LENGTH = 72;

export const NO_TRAVEL_RISK: RiskScore = 4;

export function clampForecastHour(forecastHour: number, max = HORIZON_LENGTH - 1): number {
  if (!Number.isFinite(forecastHour)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(forecastHour)));
}

export function toRiskScore(value: number | undefined): RiskScore {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(4, Math.round(value))) as RiskScore;
}

/** Risk color for a 0-4 score, safe against malformed rows. */
export function riskColor(score: number): string {
  return RISK_COLORS[toRiskScore(score)] ?? "#94a3b8";
}

export type CorridorSnapshot = {
  /** Hour index into the checkpoint horizon arrays. */
  hour: number;
  /** 0-4 risk score at that hour (falls back to risk-at-ETA when unavailable). */
  risk: RiskScore;
  windMph: number;
  rainInHr: number;
  snowInHr: number;
  /** Marker / bar color for the active layer. */
  color: string;
  /** One-line human summary shown in the map popup. */
  focus: string;
  /** Readout shown next to the risk strip bar (driven by the active layer). */
  metricLabel: string;
  /** 0-1 fill of the highlight inside the strip bar. */
  metricRatio: number;
  /** Closures layer only paints blocked checkpoints; others stay dimmed. */
  dimmed: boolean;
  noTravel: boolean;
};

function weatherAtHour(cp: CheckpointAnalysis, hour: number) {
  return {
    risk: toRiskScore(cp.horizonRiskScores?.[hour] ?? cp.riskScoreAtEta),
    windMph: cp.horizonWindMph?.[hour] ?? cp.weatherAtEta.windMph,
    rainInHr: cp.horizonRainInHr?.[hour] ?? cp.weatherAtEta.rainInHr,
    snowInHr: cp.horizonSnowInHr?.[hour] ?? cp.weatherAtEta.snowInHr,
  };
}

function windColor(windMph: number): string {
  if (windMph >= 55) return "#7f1d1d";
  if (windMph >= 45) return "#ef4444";
  if (windMph >= 35) return "#f97316";
  if (windMph >= 25) return "#eab308";
  return "#22c55e";
}

function rainColor(rainInHr: number): string {
  if (rainInHr > 1) return "#7f1d1d";
  if (rainInHr >= 0.5) return "#ef4444";
  if (rainInHr >= 0.25) return "#f97316";
  if (rainInHr >= 0.1) return "#eab308";
  return "#22c55e";
}

function snowColor(snowInHr: number): string {
  if (snowInHr > 3) return "#7f1d1d";
  if (snowInHr >= 2) return "#ef4444";
  if (snowInHr >= 1) return "#f97316";
  if (snowInHr >= 0.5) return "#eab308";
  return "#22c55e";
}

function ratio(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/** Weather + risk for a checkpoint at the given forecast hour, for the active layer. */
export function checkpointSnapshot(
  cp: CheckpointAnalysis,
  forecastHour: number,
  layer: CorridorLayer,
): CorridorSnapshot {
  const hour = clampForecastHour(forecastHour);
  const { risk, windMph, rainInHr, snowInHr } = weatherAtHour(cp, hour);
  const noTravel = risk >= NO_TRAVEL_RISK;

  let color: string;
  let focus: string;
  let metricLabel: string;
  let metricRatio: number;

  if (layer === "wind") {
    color = windColor(windMph);
    focus = `${windMph.toFixed(1)} mph wind`;
    metricLabel = `${windMph.toFixed(1)} mph`;
    metricRatio = ratio(windMph, 60);
  } else if (layer === "precipitation") {
    color = rainColor(rainInHr);
    focus = `${rainInHr.toFixed(2)} in/hr rain`;
    metricLabel = `${rainInHr.toFixed(2)} in/hr`;
    metricRatio = ratio(rainInHr, 1.5);
  } else if (layer === "snow") {
    color = snowColor(snowInHr);
    focus = `${snowInHr.toFixed(2)} in/hr snow`;
    metricLabel = `${snowInHr.toFixed(2)} in/hr`;
    metricRatio = ratio(snowInHr, 3.5);
  } else if (layer === "closures") {
    color = noTravel ? "#7f1d1d" : "#334155";
    focus = noTravel ? "No-travel likely" : "Passable";
    metricLabel = `Risk ${risk}`;
    metricRatio = ratio(risk, 4);
  } else {
    // Risk layer: bar color carries the 0-4 score, the inner fill carries the
    // dominant driver (wind), so a Low row still shows meaningful detail.
    color = riskColor(risk);
    focus = `Risk ${risk}`;
    metricLabel = `${windMph.toFixed(1)} mph wind`;
    metricRatio = ratio(windMph, 60);
  }

  return {
    hour,
    risk,
    windMph,
    rainInHr,
    snowInHr,
    color,
    focus,
    metricLabel,
    metricRatio,
    dimmed: layer === "closures" && !noTravel,
    noTravel,
  };
}
