import type { RiskScore } from "@/lib/domain";

/** "Mile" column formatting: 0 -> "0", 22.66 -> "22.7", 338.0 -> "338". */
export function formatMile(miles: number): string {
  if (!Number.isFinite(miles)) return "—";
  const rounded = Number(miles.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatEta(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function formatMph(mph: number): string {
  return Number.isFinite(mph) ? `${mph.toFixed(1)} mph` : "—";
}

export function formatInHr(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)} in/hr` : "—";
}

export function formatTempF(tempF: number): string {
  return Number.isFinite(tempF) ? `${Math.round(tempF)} °F` : "—";
}

/** Pill styling for the risk badge — pale chip with dark text, tuned per band. */
export const RISK_PILL_STYLES: Record<RiskScore, { background: string; color: string; borderColor: string }> = {
  0: { background: "#d1fae5", color: "#065f46", borderColor: "#6ee7b7" },
  1: { background: "#fef3c7", color: "#78350f", borderColor: "#fcd34d" },
  2: { background: "#ffedd5", color: "#7c2d12", borderColor: "#fdba74" },
  3: { background: "#fee2e2", color: "#7f1d1d", borderColor: "#fca5a5" },
  4: { background: "#7f1d1d", color: "#fee2e2", borderColor: "#ef4444" },
};
