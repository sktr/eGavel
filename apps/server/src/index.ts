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
import { createNostrListener } from "./nostr/listener.js"
import { createPublisher } from "./nostr/publisher.js"
import { rateLimit } from "./lib/rate-limit.js"

const app = new Hono()

app.use("*", cors())

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

app.get("/health", (c) =>
  c.json({ ok: true, pubkey: serverPubkey }),
)

const db = initDb()
const publisher = createPublisher()
const scheduler = createScheduler(db, publisher)
const nostrListener = createNostrListener(db, publisher)

app.route("/api", createAuctionRoutes(db))

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, () => {
  console.log(`server running on :${port}`)

  nostrListener.start()
  scheduler.start()

  const shutdown = () => {
    nostrListener.stop()
    scheduler.stop()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
})
