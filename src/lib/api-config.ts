// When NEXT_PUBLIC_API_BASE_URL is set (e.g. to a deployed Django backend),
// the React frontend calls that backend directly instead of the built-in
// Next.js API routes. Leave it unset to use this app's own API routes.
const RAW_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";
export const API_BASE_URL = RAW_BASE.replace(/\/$/, "");

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
