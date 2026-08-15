/**
 * API URL helpers — the single source of truth for building API URLs.
 *
 * Convention (normalized in commit 59470f9): NEXT_PUBLIC_API_URL / SSR_API_URL
 * point at the origin WITHOUT a trailing /api (the Worker serves routes at
 * /api/*, except /health which is mounted at the root). Every caller must add
 * the /api prefix explicitly; these helpers make that impossible to get wrong
 * the way loadShipping did (root-relative URL → 404 on the Worker).
 */

const DEFAULT_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Normalize a base URL: strip trailing slashes and a trailing /api. */
export function normalizeApiBase(base: string): string {
  return base.replace(/\/+$/, "").replace(/\/api$/, "");
}

function withSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** Full URL for an endpoint mounted under /api/* (most routes). */
export function apiUrl(path: string, base = DEFAULT_BASE): string {
  const root = normalizeApiBase(base);
  const p = withSlash(path);
  return p.startsWith("/api") ? `${root}${p}` : `${root}/api${p}`;
}

/** Full URL for an endpoint mounted at the root (currently only /health). */
export function rootUrl(path: string, base = DEFAULT_BASE): string {
  return `${normalizeApiBase(base)}${withSlash(path)}`;
}
