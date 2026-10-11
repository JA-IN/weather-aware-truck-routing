export type BrowserGeocode = {
  lat: number;
  lon: number;
  displayName: string;
};

const LOOKS_LIKE_COORDINATES = /^\s*-?\d{1,3}(?:\.\d+)?\s*[,，\s]\s*-?\d{1,3}(?:\.\d+)?\s*$/;
const TIMEOUT_MS = 8000;

const cache = new Map<string, BrowserGeocode | null>();

/**
 * Last-resort place resolution, run in the operator's browser.
 *
 * The server tries Nominatim first and that covers every location on earth. This
 * path only matters when the *server* has no outbound access (locked-down sandbox,
 * CI, egress allowlist) while the browser does: the query is resolved here and the
 * API is then called with "lat, lon", which the server accepts without geocoding.
 *
 * Never throws and never caches a failure - a flaky network must not permanently
 * disable lookups for that place in this session.
 */
export async function geocodeInBrowser(query: string): Promise<BrowserGeocode | null> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return null;
  if (LOOKS_LIKE_COORDINATES.test(trimmed)) return null;

  const key = trimmed.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;

    const json = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const first = json[0];
    if (!first?.lat || !first?.lon) return null;

    const result: BrowserGeocode = {
      lat: Number(first.lat),
      lon: Number(first.lon),
      displayName: first.display_name ?? trimmed,
    };
    if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon)) return null;

    cache.set(key, result);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** True when a failed analysis looks like it died on geocoding rather than scoring. */
export function isGeocodeFailure(message: string): boolean {
  return /geocod|nomina|no geocoding result|fetch failed|network request failed|failed to fetch/i.test(message);
}
