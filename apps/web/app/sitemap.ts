import type { MetadataRoute } from "next"

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "")

// Root (no /api suffix) — matches the convention used across the app.
const API_BASE = (process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "")

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: new Date() },
    { url: `${SITE_URL}/auctions`, lastModified: new Date() },
    { url: `${SITE_URL}/how-it-works`, lastModified: new Date() },
    { url: `${SITE_URL}/terms`, lastModified: new Date() },
  ]

  // Dynamic public pages: every auction detail page.
  let auctionRoutes: MetadataRoute.Sitemap = []
  try {
    const res = await fetch(`${API_BASE}/api/auctions`, { cache: "no-store" })
    if (res.ok) {
      const auctions = (await res.json()) as { id: string }[]
      auctionRoutes = auctions.map((a) => ({
        url: `${SITE_URL}/auctions/${a.id}`,
        lastModified: new Date(),
      }))
    }
  } catch {
    // sitemap still serves the static routes if the API is down
  }

  return [...staticRoutes, ...auctionRoutes]
}
