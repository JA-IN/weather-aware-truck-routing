"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RISK_COLORS, RISK_LABELS, type RouteAnalysisResponse } from "@/lib/domain";
import type { CorridorLayer } from "@/components/corridor-map";
import { apiUrl } from "@/lib/api-config";

const CorridorMap = dynamic(() => import("@/components/corridor-map").then((m) => m.CorridorMap), {
  ssr: false,
});

type PlannerState = {
  origin: string;
  destination: string;
  departureIsoLocal: string;
  loadWeightLbs: string;
  sampleMiles: "10" | "25" | "50";
};

const DEFAULT_STATE: PlannerState = {
  origin: "Dallas, TX",
  destination: "Denver, CO",
  departureIsoLocal: new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16),
  loadWeightLbs: "36000",
  sampleMiles: "25",
};

function scoreLabel(score: number): string {
  return RISK_LABELS[Math.max(0, Math.min(4, Math.round(score)))] ?? "Unknown";
}

function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatShift(shiftHours: number): string {
  if (shiftHours === 0) return "Leave now";
  return `Delay ${shiftHours}h`;
}

export function RoutePlanner() {
  const [form, setForm] = useState<PlannerState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RouteAnalysisResponse | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  const [layer, setLayer] = useState<CorridorLayer>("risk");
  const [forecastHour, setForecastHour] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);

  const selectedRoute = useMemo(() => {
    if (!data) return null;
    return data.routes.find((r) => r.id === (selectedRouteId ?? data.recommendedRouteId)) ?? data.routes[0];
  }, [data, selectedRouteId]);

  const routeOptions = data?.routes ?? [];

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setForecastHour((h) => (h >= 48 ? 0 : h + 1));
    }, 1200);
    return () => clearInterval(timer);
  }, [isPlaying]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const departure = new Date(form.departureIsoLocal);
      const body = {
        origin: form.origin,
        destination: form.destination,
        departureIso: departure.toISOString(),
        loadWeightLbs: Number(form.loadWeightLbs),
        sampleMiles: Number(form.sampleMiles),
      };

      const res = await fetch(apiUrl("/api/route-analysis"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as RouteAnalysisResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to analyze route");

      setData(json);
      setSelectedRouteId(json.recommendedRouteId);
      setCompareA(json.routes[0]?.id ?? null);
      setCompareB(json.routes[1]?.id ?? json.routes[0]?.id ?? null);
      setForecastHour(0);
      setIsPlaying(false);
      setLayer("risk");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1260px] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="bento-card motion-fade-up flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Command Center</p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Weather-Aware Truck Routing</h1>
            <p className="mt-2 text-sm text-slate-300">Minimal dashboard with layered weather intelligence and explainable route decisions.</p>
          </div>
          <Link href="/" className="btn-secondary">
            Home
          </Link>
        </header>

        <section className="bento-card motion-fade-up p-5">
          <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="field-group"><span className="field-label">Origin</span><input className="field-input" value={form.origin} onChange={(e) => setForm((s) => ({ ...s, origin: e.target.value }))} required /></label>
            <label className="field-group"><span className="field-label">Destination</span><input className="field-input" value={form.destination} onChange={(e) => setForm((s) => ({ ...s, destination: e.target.value }))} required /></label>
            <label className="field-group"><span className="field-label">Departure</span><input type="datetime-local" className="field-input" value={form.departureIsoLocal} onChange={(e) => setForm((s) => ({ ...s, departureIsoLocal: e.target.value }))} required /></label>
            <label className="field-group"><span className="field-label">Load (lbs)</span><input type="number" min={1} className="field-input" value={form.loadWeightLbs} onChange={(e) => setForm((s) => ({ ...s, loadWeightLbs: e.target.value }))} required /></label>
            <label className="field-group"><span className="field-label">Interval</span><select className="field-input" value={form.sampleMiles} onChange={(e) => setForm((s) => ({ ...s, sampleMiles: e.target.value as PlannerState["sampleMiles"] }))}><option value="10">10 mi</option><option value="25">25 mi</option><option value="50">50 mi</option></select></label>
            <button type="submit" disabled={loading} className="btn-primary md:col-span-2 lg:col-span-5">{loading ? "Analyzing..." : "Run Route Risk Analysis"}</button>
          </form>
          {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
        </section>

        {data ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="bento-card motion-fade-up p-4"><p className="text-xs text-slate-400">Routes</p><p className="mt-1 text-xl font-semibold text-white">{data.routes.length}</p></div>
              <div className="bento-card motion-fade-up p-4"><p className="text-xs text-slate-400">Best shift</p><p className="mt-1 text-xl font-semibold text-white">{formatShift(data.departureOptimization.bestShiftHours)}</p></div>
              <div className="bento-card motion-fade-up p-4"><p className="text-xs text-slate-400">Sample</p><p className="mt-1 text-xl font-semibold text-white">{data.sampleMiles} mi</p></div>
              <div className="bento-card motion-fade-up p-4"><p className="text-xs text-slate-400">Load</p><p className="mt-1 text-xl font-semibold text-white">{data.loadWeightLbs.toLocaleString()} lb</p></div>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              {data.routes.map((route) => (
                <button key={route.id} onClick={() => setSelectedRouteId(route.id)} className={`route-option-card motion-fade-up ${route.id === selectedRoute?.id ? "route-option-card--active" : ""}`}>
                  <div className="flex items-center justify-between"><h3 className="font-semibold text-white">{route.label}</h3>{route.id === data.recommendedRouteId ? <span className="text-xs text-emerald-300">Recommended</span> : null}</div>
                  <p className="mt-2 text-xs text-slate-400">Rank #{route.rank}</p>
                  <p className="mt-2 text-sm text-slate-200">{route.summary.distanceMiles} mi • {route.summary.durationMinutes} min</p>
                  <p className="text-xs text-slate-400">Severe {route.summary.severeMiles} • High {route.summary.highMiles}</p>
                </button>
              ))}
            </section>

            <section className="grid gap-4 lg:grid-cols-6">
              <article className="bento-card motion-fade-up p-4 lg:col-span-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-white">Playback + Layer Controls</h2>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setIsPlaying((v) => !v)} className="btn-secondary text-xs">{isPlaying ? "Pause" : "Play"}</button>
                    <button type="button" onClick={() => { setForecastHour(0); setIsPlaying(false); }} className="btn-secondary text-xs">Reset</button>
                    <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">+{forecastHour}h</span>
                  </div>
                </div>
                <input type="range" min={0} max={48} step={1} value={forecastHour} onChange={(e) => setForecastHour(Number(e.target.value))} className="mt-3 w-full" />
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["risk", "wind", "precipitation", "snow", "closures"] as CorridorLayer[]).map((l) => (
                    <button type="button" key={l} onClick={() => setLayer(l)} className={`rounded-full px-3 py-1 text-xs ring-1 ${layer === l ? "bg-cyan-400/15 text-cyan-200 ring-cyan-300/40" : "bg-white/5 text-slate-200 ring-white/20"}`}>
                      {l}
                    </button>
                  ))}
                </div>
                {selectedRoute ? <div className="mt-4"><CorridorMap routes={data.routes} selectedRouteId={selectedRoute.id} forecastHour={forecastHour} layer={layer} showAllRoutes /></div> : null}
              </article>

              <article className="bento-card motion-fade-up p-4 lg:col-span-2">
                <h3 className="text-base font-semibold text-white">Why recommended</h3>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
                  {data.explainability.strategy.map((s) => <li key={s}>{s}</li>)}
                </ol>
                <div className="mt-3 text-xs text-slate-300">
                  {data.explainability.runnerUpDelta ? (
                    <>
                      <p>Δ Severe: {data.explainability.runnerUpDelta.severeMiles}</p>
                      <p>Δ High: {data.explainability.runnerUpDelta.highMiles}</p>
                      <p>Δ Risk: {data.explainability.runnerUpDelta.avgRiskScore}</p>
                    </>
                  ) : <p>No runner-up data available.</p>}
                </div>
                <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 p-2 text-xs text-rose-100">
                  {data.explainability.noTravelAlerts.length > 0 ? data.explainability.noTravelAlerts.join(" • ") : "No no-travel closures on recommended route."}
                </div>
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="bento-card motion-fade-up p-4">
                <h3 className="text-base font-semibold text-white">Side-by-Side Route Compare</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <select className="field-input" value={compareA ?? ""} onChange={(e) => setCompareA(e.target.value)}>{routeOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
                  <select className="field-input" value={compareB ?? ""} onChange={(e) => setCompareB(e.target.value)}>{routeOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  {compareA ? <CorridorMap routes={data.routes} selectedRouteId={compareA} forecastHour={forecastHour} layer={layer} showAllRoutes={false} /> : null}
                  {compareB ? <CorridorMap routes={data.routes} selectedRouteId={compareB} forecastHour={forecastHour} layer={layer} showAllRoutes={false} /> : null}
                </div>
              </article>

              <article className="bento-card motion-fade-up p-4">
                <h3 className="text-base font-semibold text-white">Scenario Snapshots</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {data.departureOptimization.options.slice(0, 4).map((opt) => {
                    const isBest = opt.shiftHours === data.departureOptimization.bestShiftHours;
                    return (
                      <div key={opt.shiftHours} className={`rounded-xl border p-3 ${isBest ? "border-emerald-300/40 bg-emerald-500/10" : "border-white/15 bg-white/5"}`}>
                        <p className="text-xs uppercase tracking-wide text-slate-400">{formatShift(opt.shiftHours)}</p>
                        <p className="mt-1 text-sm text-white">{formatLocal(opt.departureIso)}</p>
                        <p className="mt-2 text-xs text-slate-300">Avg Risk {opt.avgRiskScore} ({scoreLabel(opt.avgRiskScore)})</p>
                        <div className="mt-2 h-2 rounded-full bg-slate-800">
                          <div className="h-2 rounded-full" style={{ width: `${Math.min(100, opt.avgRiskScore * 25)}%`, background: RISK_COLORS[Math.round(Math.min(4, opt.avgRiskScore))] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
