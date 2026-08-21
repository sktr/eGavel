import type { NextConfig } from "next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isProd = process.env.NODE_ENV === "production"

// Security headers applied to every route. Next.js does not set these by
// default — they are mandatory for a money-handling web app.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
]

// CSP: the app uses inline <style>/style attributes heavily (design tokens,
// styled components), so `style-src 'unsafe-inline'` is required. Next.js
// App Router injects inline bootstrap scripts, hence `script-src 'unsafe-inline'`.
// Dev additionally needs `'unsafe-eval'` for webpack HMR.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  // Auction images are data: URLs; parseRow also accepts https?:// image URLs.
  "img-src 'self' data: https: http:",
  "font-src 'self'",
  // API (NEXT_PUBLIC_API_URL) + Cashu mints are cross-origin https.
  // Nostr relays (NIP-99 listing mirror + audit log) need wss:.
  "connect-src 'self' https: wss: http://localhost:3001",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

if (isProd) {
  securityHeaders.push({ key: "Content-Security-Policy", value: csp })
}

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

export default config
