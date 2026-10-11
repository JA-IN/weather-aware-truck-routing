import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const search = url.searchParams.toString();
  const upstream = `https://api.open-meteo.com/v1/forecast?${search}`;

  try {
    const res = await fetch(upstream, {
      headers: {
        "User-Agent": "weather-aware-truck-routing/1.0",
        Accept: "application/json",
      },
      next: { revalidate: 0 },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
