import "dotenv/config"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { getPublicKey } from "nostr-tools"
import { nip19 } from "nostr-tools"
import { hexToBytes } from "nostr-tools/utils"
import { initDb } from "./db/index.js"
import { createAuctionRoutes } from "./routes/auctions.js"
import { createScheduler } from "./scheduler/index.js"
import { rateLimit } from "./lib/rate-limit.js"

const app = new Hono()

app.use("*", cors())

// Log every request with its status so 4xx/5xx errors are diagnosable.
app.use("*", async (c, next) => {
  await next()
  try {
    const status = c.res.status
    if (status >= 400) {
      // Log the error body for 4xx/5xx so rejections are diagnosable.
      const body = await c.res.clone().text()
      console.log(`${c.req.method} ${c.req.path} -> ${status} body=${body.slice(0, 300)}`)
    } else {
      console.log(`${c.req.method} ${c.req.path} -> ${status}`)
    }
  } catch (err) {
    // Logging must never take the server down.
    console.error("request log failed:", err)
  }
})

app.use("/api/bids", rateLimit({ windowMs: 60_000, max: 30 }))
app.use("/api/auctions/*/co-sign", rateLimit({ windowMs: 60_000, max: 20 }))
app.use("/api/auctions/*/claim-data", rateLimit({ windowMs: 60_000, max: 30 }))
app.use("/api/auctions/*/shipping", rateLimit({ windowMs: 60_000, max: 30 }))
app.use("/api/bids/*/refund-data", rateLimit({ windowMs: 60_000, max: 30 }))

// Derive server pubkey from env (if NOSTR_PRIVATE_KEY is set)
function getServerPubkey(): string | null {
  const key = process.env.NOSTR_PRIVATE_KEY
  if (!key) return null
  let sk: Uint8Array
  if (!key.startsWith("nsec")) {
    sk = hexToBytes(key)
  } else {
    const decoded = nip19.decode(key)
    sk = decoded.data as Uint8Array
  }
  try {
    return getPublicKey(sk)
  } catch {
    return null
  }
}

const serverPubkey = getServerPubkey()

if (!serverPubkey) {
  console.warn(
    "WARNING: NOSTR_PRIVATE_KEY is not set — the server cannot co-sign or verify bids. " +
      "Set it in apps/server/.env before placing bids.",
  )
}

app.get("/health", (c) =>
  c.json({ ok: true, pubkey: serverPubkey }),
)

const db = initDb()
const scheduler = createScheduler(db)

app.route("/api", createAuctionRoutes(db))

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, () => {
  console.log(`server running on :${port}`)

  scheduler.start()

  const shutdown = () => {
    scheduler.stop()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
})
