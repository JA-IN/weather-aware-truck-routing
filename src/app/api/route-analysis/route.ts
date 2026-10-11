import { NextResponse } from "next/server";
import { z } from "zod";
import { getStoredAnalysis, runRouteAnalysis } from "@/lib/weather-routing";

export const dynamic = "force-dynamic";

const REQUESTS_PER_MINUTE = 20;
const WINDOW_MS = 60_000;

const postSchema = z.object({
  origin: z.string().trim().min(2).max(180),
  destination: z.string().trim().min(2).max(180),
  departureIso: z.string().datetime(),
  loadWeightLbs: z.number().finite().positive().max(200_000),
  sampleMiles: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});

const globalForRateLimit = globalThis as typeof globalThis & {
  __routeAnalysisRateLimit?: Map<string, number[]>;
};

const requestLog = globalForRateLimit.__routeAnalysisRateLimit ?? new Map<string, number[]>();
globalForRateLimit.__routeAnalysisRateLimit = requestLog;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function resolveClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "unknown";
}

function enforceRateLimit(ip: string): boolean {
  const now = Date.now();
  const start = now - WINDOW_MS;
  const hits = requestLog.get(ip) ?? [];
  const nextHits = hits.filter((t) => t >= start);
  if (nextHits.length >= REQUESTS_PER_MINUTE) {
    requestLog.set(ip, nextHits);
    return false;
  }
  nextHits.push(now);
  requestLog.set(ip, nextHits);
  return true;
}

export async function POST(req: Request) {
  try {
    const ip = resolveClientIp(req);
    if (!enforceRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait and retry." },
        {
          status: 429,
          headers: { "Retry-After": "60" },
        },
      );
    }

    const raw = (await req.json()) as unknown;
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid request payload.");
    }

    const result = await runRouteAnalysis(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("requestId"));
  if (!Number.isInteger(id) || id <= 0) {
    return badRequest("A valid requestId query parameter is required.");
  }

  const data = await getStoredAnalysis(id);
  if (!data) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
