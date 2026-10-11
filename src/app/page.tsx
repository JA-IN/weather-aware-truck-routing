import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="bento-card motion-fade-up relative overflow-hidden p-8">
          <div className="pointer-events-none absolute -right-14 -top-14 h-56 w-56 rounded-full bg-cyan-400/15 blur-3xl" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Welcome</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Safer trucking decisions, powered by weather-aware routing intelligence.
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-slate-300 sm:text-base">
            Compare route options, animate forecast risk over time, and choose the most reliable corridor for your fleet.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/planner" className="btn-primary">
              Enter Command Center
            </Link>
            <a href="#features" className="btn-secondary">
              Explore Features
            </a>
          </div>
        </header>

        <section id="features" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <article className="bento-card motion-fade-up p-5 lg:col-span-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Core</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Weather Risk Routing</h2>
            <p className="mt-2 text-sm text-slate-300">
              Generate route alternatives and evaluate risk using wind, rain, snow, load weight, and ETA checkpoints.
            </p>
          </article>

          <article className="bento-card motion-fade-up p-5 lg:col-span-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Interactive</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Playback + Layered Maps</h2>
            <p className="mt-2 text-sm text-slate-300">
              Play forecast evolution from 0–48h and toggle risk, wind, precipitation, snow, and closures layers.
            </p>
          </article>

          <article className="bento-card motion-fade-up p-5 lg:col-span-2">
            <h3 className="text-lg font-semibold text-white">Explainability</h3>
            <p className="mt-2 text-sm text-slate-300">Transparent ranking criteria and winner vs runner-up deltas.</p>
          </article>

          <article className="bento-card motion-fade-up p-5 lg:col-span-2">
            <h3 className="text-lg font-semibold text-white">Scenario Snapshots</h3>
            <p className="mt-2 text-sm text-slate-300">Compare departure-time options and identify safer shift windows.</p>
          </article>

          <article className="bento-card motion-fade-up p-5 lg:col-span-2">
            <h3 className="text-lg font-semibold text-white">Persistence</h3>
            <p className="mt-2 text-sm text-slate-300">Route analyses are stored and retrievable from PostgreSQL via Drizzle.</p>
          </article>
        </section>

        <footer className="motion-fade-up rounded-2xl border border-white/10 bg-slate-900/70 px-5 py-4 text-xs text-slate-400">
          Built for dispatchers, safety teams, and fleet operators who prioritize correctness and clarity.
        </footer>
      </div>
    </main>
  );
}
