/**
 * SSRF guard for user-supplied Cashu mint URLs.
 *
 * The server performs server-side fetches against a listing's mint_url during
 * bid verification (NUT-06 / NUT-07 checks) and claim (swap). Without a
 * scheme/host check, a seller could point mint_url at an internal address
 * (e.g. a cloud metadata endpoint or a private service) and have the server
 * make requests to it. This module rejects such URLs.
 *
 * Rules:
 * - `test://local` is allowed only when allowTestBids is set (dev-only mint).
 * - Scheme must be `https:`.
 * - Host must not be a private / loopback / link-local IP literal, and must
 *   not be `localhost` or another loopback name.
 *
 * DNS names are accepted (a name can resolve to anything), which is the
 * pragmatic trade-off: blocking IP literals closes the obvious metadata /
 * internal-service vectors without requiring a resolver.
 */

const TEST_MINT_URL = "test://local";

/** Loopback hostnames (case-insensitive). */
const LOOPBACK_HOSTS = new Set(["localhost", "localhost.localdomain"]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false; // not an IPv4 literal
  }
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isPrivateIpv6(host: string): boolean {
  // ::1 loopback, fc00::/7 ULA, fe80::/10 link-local, :: unspecified
  if (host === "::" || host === "::1") return true;
  const lower = host.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  return false;
}

function isIpLiteral(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(":");
}

export function isValidMintUrl(
  mintUrl: string,
  opts: { allowTestBids?: boolean } = {},
): boolean {
  if (mintUrl === TEST_MINT_URL) return opts.allowTestBids === true;
  if (!mintUrl) return false;

  let url: URL;
  try {
    url = new URL(mintUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(host)) return false;

  if (isIpLiteral(host)) {
    if (isPrivateIpv4(host) || isPrivateIpv6(host)) return false;
    // A public IP literal is fine.
    return true;
  }

  // DNS hostname — accepted (see module doc for the trade-off).
  return true;
}
