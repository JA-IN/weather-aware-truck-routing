import { RISK_LABELS, type CheckpointAnalysis, type RiskLabel, type RiskScore } from "@/lib/domain";

function windRiskScore(windMph: number): RiskScore {
  if (windMph >= 55) return 4;
  if (windMph >= 45) return 3;
  if (windMph >= 35) return 2;
  if (windMph >= 25) return 1;
  return 0;
}

function rainRiskScore(rainInHr: number): RiskScore {
  if (rainInHr > 1.0) return 4;
  if (rainInHr >= 0.5) return 3;
  if (rainInHr >= 0.25) return 2;
  if (rainInHr >= 0.1) return 1;
  return 0;
}

function snowRiskScore(snowInHr: number): RiskScore {
  if (snowInHr > 3.0) return 4;
  if (snowInHr >= 2.0) return 3;
  if (snowInHr >= 1.0) return 2;
  if (snowInHr >= 0.5) return 1;
  return 0;
}

export function applyLoadRules(baseRisk: RiskScore, windMph: number, loadWeightLbs: number): RiskScore {
  if (windMph >= 55) return 4;
  if (windMph >= 45 && windMph < 55 && loadWeightLbs > 30000) return 4;
  if (windMph >= 35 && windMph < 45 && loadWeightLbs > 40000) {
    return Math.max(baseRisk, 3) as RiskScore;
  }
  return baseRisk;
}

export function classifyRisk(
  windMph: number,
  rainInHr: number,
  snowInHr: number,
  loadWeightLbs: number,
): RiskScore {
  const weatherRisk = Math.max(windRiskScore(windMph), rainRiskScore(rainInHr), snowRiskScore(snowInHr)) as RiskScore;
  return applyLoadRules(weatherRisk, windMph, loadWeightLbs);
}

export function riskLabel(score: RiskScore): RiskLabel {
  return RISK_LABELS[score];
}

export function summarizeCheckpointRisks(
  checkpoints: CheckpointAnalysis[],
  distanceMiles: number,
): {
  severeMiles: number;
  highMiles: number;
  noTravelMiles: number;
  avgRiskScore: number;
} {
  if (checkpoints.length === 0) {
    return { severeMiles: 0, highMiles: 0, noTravelMiles: 0, avgRiskScore: 0 };
  }

  const segmentMiles = checkpoints.length > 1 ? distanceMiles / (checkpoints.length - 1) : 0;

  let severeMiles = 0;
  let highMiles = 0;
  let noTravelMiles = 0;

  for (let i = 0; i < checkpoints.length - 1; i += 1) {
    const score = checkpoints[i].riskScoreAtEta;
    if (score >= 3) severeMiles += segmentMiles;
    if (score >= 2) highMiles += segmentMiles;
    if (score >= 4) noTravelMiles += segmentMiles;
  }

  const avgRiskScore =
    checkpoints.reduce((acc, cp) => acc + cp.riskScoreAtEta, 0) / Math.max(1, checkpoints.length);

  return { severeMiles, highMiles, noTravelMiles, avgRiskScore };
}
