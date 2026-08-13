import { Hono } from "hono"
import { cors } from "hono/cors"
import { getPublicKey } from "nostr-tools"
import { nip19 } from "nostr-tools"
import { hexToBytes } from "nostr-tools/utils"
import type { Db } from "./db/index.js"
import { createAuctionRoutes, type AuctionRoutesConfig } from "./routes/auctions.js"
import { rateLimit } from "./lib/rate-limit.js"

export interface AppConfig extends AuctionRoutesConfig {}

/** Derive the x-only server pubkey from a signing key (nsec or hex). */
export function getServerPubkey(key: string | undefined): string | null {
  if (!key) return null
  try {
    if (!key.startsWith("nsec")) return getPublicKey(hexToBytes(key))
    const { data } = nip19.decode(key)
    return getPublicKey(data as Uint8Array)
  } catch {
    return null
  }
}

/**
 * Builds the Hono app for a given Db. Shared by the Node entry (better-sqlite3)
 * and the Cloudflare Worker entry (D1). The server signing key and fee rate are
 * injected via config so the same code runs under `process.env` (Node) and
 * Worker bindings (env).
 */
export function createApp(db: Db, config: AppConfig = {}) {
  const app = new Hono()

  app.use("*", cors())

  // Log every request with its status so 4xx/5xx errors are diagnosable.
  app.use("*", async (c, next) => {
    await next()
    try {
      const status = c.res.status
      if (status >= 400) {
        const body = await c.res.clone().text()
        console.log(`${c.req.method} ${c.req.path} -> ${status} body=${body.slice(0, 300)}`)
      } else {
        console.log(`${c.req.method} ${c.req.path} -> ${status}`)
      }
    } catch (err) {
      console.error("request log failed:", err)
    }
  })

  app.use("/api/bids", rateLimit({ windowMs: 60_000, max: 30 }))
  app.use("/api/auctions", rateLimit({ windowMs: 60_000, max: 10 }))
  app.use("/api/auctions/*/co-sign", rateLimit({ windowMs: 60_000, max: 20 }))
  app.use("/api/auctions/*/claim-data", rateLimit({ windowMs: 60_000, max: 30 }))
  app.use("/api/auctions/*/shipping", rateLimit({ windowMs: 60_000, max: 30 }))
  app.use("/api/bids/*/refund-data", rateLimit({ windowMs: 60_000, max: 30 }))

  const serverPubkey = getServerPubkey(config.serverKey)
  if (!serverPubkey) {
    console.warn(
      "WARNING: server signing key is not set — the server cannot co-sign or verify bids. " +
        "Set NOSTR_PRIVATE_KEY (Node) / the NOSTR_PRIVATE_KEY binding (Worker).",
    )
  }

  app.get("/health", (c) => c.json({ ok: true, pubkey: serverPubkey }))

  app.route("/api", createAuctionRoutes(db, config))

  return app
}
