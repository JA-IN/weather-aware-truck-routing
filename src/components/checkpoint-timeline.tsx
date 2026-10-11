"use client";

import { useEffect, useRef } from "react";
import { checkpointSnapshot, MAX_FORECAST_HOUR, clampForecastHour, riskColor, type CorridorLayer } from "@/lib/corridor";
import { RISK_LABELS, type CheckpointAnalysis } from "@/lib/domain";
import { formatEta, formatInHr, formatMile, formatMph, formatTempF, RISK_PILL_STYLES } from "@/lib/format";

function RiskPill({ risk, className = "" }: { risk: number; className?: string }) {
  const safe = Math.max(0, Math.min(4, Math.round(risk))) as 0 | 1 | 2 | 3 | 4;
  const style = RISK_PILL_STYLES[safe];
  return (
    <span
      className={`cp-pill ${className}`}
      style={{ background: style.background, color: style.color, borderColor: style.borderColor }}
    >
      {RISK_LABELS[safe]}
    </span>
  );
}

type StripProps = {
  checkpoints: CheckpointAnalysis[];
  forecastHour: number;
  layer: CorridorLayer;
  activeIndex: number | null;
  onActiveIndexChange: (index: number) => void;
  onJumpToEta: (forecastHour: number) => void;
};

/**
 * Compact per-checkpoint risk strip: "Mile 22.7" + a bar colored by the active
 * layer + the risk chip. Rows stay in sync with the forecast slider and clicking
 * one jumps the slider to that checkpoint's ETA.
 */
export function CheckpointRiskStrip({
  checkpoints,
  forecastHour,
  layer,
  activeIndex,
  onActiveIndexChange,
  onJumpToEta,
}: StripProps) {
  if (checkpoints.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <p className="text-[0.68rem] uppercase tracking-[0.16em] text-slate-400">Corridor by checkpoint</p>
        <p className="text-[0.68rem] text-slate-500">click a row to jump the slider to its ETA</p>
      </div>
      <div className="cp-scroll max-h-52 overflow-y-auto px-2 py-2">
        <ul className="flex flex-col gap-1.5">
          {checkpoints.map((cp, idx) => {
            const snapshot = checkpointSnapshot(cp, forecastHour, layer);
            const etaHour = clampForecastHour(cp.etaOffsetHours, MAX_FORECAST_HOUR);
            const isActive = activeIndex === idx;

            return (
              <li key={`${cp.mileMarker}-${idx}`}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  onMouseEnter={() => onActiveIndexChange(idx)}
                  onFocus={() => onActiveIndexChange(idx)}
                  onClick={() => onJumpToEta(etaHour)}
                  className={`risk-strip-row ${isActive ? "risk-strip-row--active" : ""}`}
                  style={{ opacity: snapshot.dimmed ? 0.34 : 1 }}
                >
                  <span className="risk-strip-row__mile">Mile {formatMile(cp.mileMarker)}</span>
                  <span className="risk-bar" style={{ background: snapshot.color }}>
                    <span className="risk-bar__fill" style={{ width: `${Math.round(snapshot.metricRatio * 100)}%` }} />
                  </span>
                  <span className="risk-strip-row__metric">{snapshot.metricLabel}</span>
                  <RiskPill risk={snapshot.risk} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

type TimelineProps = {
  routeLabel: string;
  checkpoints: CheckpointAnalysis[];
  activeIndex: number | null;
  onActiveIndexChange: (index: number) => void;
};

/**
 * "Checkpoint Weather & Risk Timeline" — weather and risk sampled at each
 * checkpoint's own ETA (not the slider hour), so it matches the ETA column.
 */
export function CheckpointTimeline({ routeLabel, checkpoints, activeIndex, onActiveIndexChange }: TimelineProps) {
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  useEffect(() => {
    if (activeIndex === null) return;
    const row = rowRefs.current.get(activeIndex);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const worst = checkpoints.reduce((acc, cp) => Math.max(acc, cp.riskScoreAtEta), 0);
  const noTravelCount = checkpoints.filter((cp) => cp.riskScoreAtEta >= 4).length;
  const severeCount = checkpoints.filter((cp) => cp.riskScoreAtEta >= 3).length;

  return (
    <section className="bento-card motion-fade-up p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white sm:text-xl">Checkpoint Weather &amp; Risk Timeline</h2>
          <p className="mt-1 text-xs text-slate-400">
            {routeLabel} • weather sampled at each checkpoint&apos;s ETA • {checkpoints.length} checkpoints
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[0.7rem]">
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-slate-300">
            Worst risk at ETA: {RISK_LABELS[Math.max(0, Math.min(4, Math.round(worst)))]}
          </span>
          <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-amber-200">
            {severeCount} severe+
          </span>
          <span className="rounded-full border border-rose-300/30 bg-rose-500/10 px-3 py-1 text-rose-200">
            {noTravelCount} no-travel
          </span>
        </div>
      </div>

      <div className="cp-scroll mt-4 max-h-[30rem] overflow-auto rounded-xl border border-white/10">
        <table className="cp-table w-full min-w-[54rem] border-collapse text-left text-sm">
          <thead>
            <tr>
              <th className="cp-th w-24">Mile</th>
              <th className="cp-th w-52">ETA</th>
              <th className="cp-th">Wind</th>
              <th className="cp-th">Rain</th>
              <th className="cp-th">Snow</th>
              <th className="cp-th">Temp</th>
              <th className="cp-th w-28">Risk</th>
            </tr>
          </thead>
          <tbody>
            {checkpoints.map((cp, idx) => {
              const isActive = activeIndex === idx;
              const border = riskColor(cp.riskScoreAtEta);

              return (
                <tr
                  key={`${cp.mileMarker}-${idx}`}
                  ref={(el) => {
                    if (el) rowRefs.current.set(idx, el);
                    else rowRefs.current.delete(idx);
                  }}
                  onMouseEnter={() => onActiveIndexChange(idx)}
                  className={`cp-row ${isActive ? "cp-row--active" : ""}`}
                  style={{ boxShadow: `inset 3px 0 0 ${border}` }}
                >
                  <td className="cp-td cp-td--mile">{formatMile(cp.mileMarker)}</td>
                  <td className="cp-td text-slate-300">{formatEta(cp.etaIso)}</td>
                  <td className="cp-td">{formatMph(cp.weatherAtEta.windMph)}</td>
                  <td className="cp-td">{formatInHr(cp.weatherAtEta.rainInHr)}</td>
                  <td className="cp-td">{formatInHr(cp.weatherAtEta.snowInHr)}</td>
                  <td className="cp-td">{formatTempF(cp.weatherAtEta.temperatureF)}</td>
                  <td className="cp-td">
                    <RiskPill risk={cp.riskScoreAtEta} />
                  </td>
                </tr>
              );
            })}
            {checkpoints.length === 0 ? (
              <tr>
                <td className="cp-td text-slate-400" colSpan={7}>
                  No checkpoints for this route.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
