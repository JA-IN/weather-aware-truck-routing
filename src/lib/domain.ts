export const RISK_LABELS = ["Low", "Moderate", "High", "Severe", "No Travel"] as const;
export const RISK_COLORS = ["#22c55e", "#eab308", "#f97316", "#ef4444", "#7f1d1d"] as const;

export type RiskLabel = (typeof RISK_LABELS)[number];

export type RiskScore = 0 | 1 | 2 | 3 | 4;

export type Coordinate = {
  lat: number;
  lon: number;
};

export type WeatherSample = {
  timeIso: string;
  windMph: number;
  rainInHr: number;
  snowInHr: number;
  precipitationInHr: number;
  temperatureF: number;
};

export type CheckpointAnalysis = {
  mileMarker: number;
  coordinate: Coordinate;
  etaIso: string;
  etaOffsetHours: number;
  weatherAtEta: WeatherSample;
  riskScoreAtEta: RiskScore;
  riskLabelAtEta: RiskLabel;
  horizonRiskScores: RiskScore[];
  horizonWindMph: number[];
  horizonRainInHr: number[];
  horizonSnowInHr: number[];
};

export type RouteSummary = {
  distanceMiles: number;
  durationMinutes: number;
  severeMiles: number;
  highMiles: number;
  noTravelMiles: number;
  avgRiskScore: number;
  recommendationReasons: string[];
};

export type RouteOption = {
  id: string;
  label: string;
  rank: number;
  geometry: Coordinate[];
  checkpoints: CheckpointAnalysis[];
  summary: RouteSummary;
};

export type DepartureShiftOption = {
  shiftHours: number;
  departureIso: string;
  avgRiskScore: number;
  severeMiles: number;
  highMiles: number;
  noTravelMiles: number;
  note: string;
};

export type DepartureOptimization = {
  baselineDepartureIso: string;
  bestShiftHours: number;
  bestDepartureIso: string;
  options: DepartureShiftOption[];
};

export type Explainability = {
  strategy: string[];
  winnerRouteId: string;
  winnerReasons: string[];
  runnerUpDelta: {
    severeMiles: number;
    highMiles: number;
    avgRiskScore: number;
    durationMinutes: number;
  } | null;
  noTravelAlerts: string[];
};

export type RouteAnalysisResponse = {
  requestId: number;
  origin: string;
  destination: string;
  departureIso: string;
  loadWeightLbs: number;
  sampleMiles: number;
  recommendedRouteId: string;
  routes: RouteOption[];
  /** "offline" = geocoding/routing providers were unreachable and a gated fallback was used. */
  dataSource?: "live" | "offline";
  departureOptimization: DepartureOptimization;
  explainability: Explainability;
};
