import { Hono } from "hono";
import { cors } from "hono/cors";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "./lib/hex.js";
import type { Db } from "./db/index.js";
import { createAuctionRoutes, type AuctionRoutesConfig } from "./routes/auctions.js";
import { rateLimit } from "./lib/rate-limit.js";

export interface AppConfig extends AuctionRoutesConfig {}

/** Derive the x-only server pubkey from a signing key (nsec or hex). */
export function getServerPubkey(key: string | undefined): string | null {
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) return null;
  try {
    return bytesToHex(schnorr.getPublicKey(hexToBytes(key)));
  } catch {
    return null;
  }
}

/**
 * Builds the Hono app for a given Db. Shared by the Node entry (better-sqlite3)
 * and the Cloudflare Worker entry (D1). The server signing key and fee rate are
 * injected via config so the same code runs under `process.env` (Node) and
 * Worker bindings (env).
 */
export function createApp(db: Db, config: AppConfig = {}) {
  const app = new Hono();

  app.use("*", cors());

  // Security headers for the API surface (HSTS is ignored over plain http in
  // dev, which is fine; Cloudflare serves the Worker over https in prod).
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "SAMEORIGIN");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  });

  // Log every request with its status so 4xx/5xx errors are diagnosable.
  app.use("*", async (c, next) => {
    await next();
    try {
      const status = c.res.status;
      if (status >= 400) {
        const body = await c.res.clone().text();
        console.log(`${c.req.method} ${c.req.path} -> ${status} body=${body.slice(0, 300)}`);
      } else {
        console.log(`${c.req.method} ${c.req.path} -> ${status}`);
      }
    } catch (err) {
      console.error("request log failed:", err);
    }
  });

  app.use("/api/bids", rateLimit({ windowMs: 60_000, max: 30 }));
  // Link identity keys (NIP-98) is a write-heavy, abuse-prone surface.
  app.use("/api/identity/nostr-link", rateLimit({ windowMs: 60_000, max: 10 }));
  // Reads (list + homepage live poll) get a generous budget; writes stay strict.
  app.use("/api/auctions", rateLimit({ windowMs: 60_000, max: 120, methods: ["GET"] }));
  app.use("/api/auctions", rateLimit({ windowMs: 60_000, max: 10 }));
  app.use("/api/auctions/*/co-sign", rateLimit({ windowMs: 60_000, max: 20 }));
  app.use("/api/auctions/*/claim-data", rateLimit({ windowMs: 60_000, max: 30 }));
  app.use("/api/bids/*/refund-data", rateLimit({ windowMs: 60_000, max: 30 }));
  app.use("/api/auctions/:id/escrow", rateLimit({ windowMs: 60_000, max: 30 }));
  // NUT-18 receive (GET poll) + signed ack + payer POST share one bucket.
  // Unauthenticated POSTs would otherwise allow unbounded row growth.
  app.use("/api/wallet/receive", rateLimit({ windowMs: 60_000, max: 60 }));
  app.use("/api/auctions/*/shipped", rateLimit({ windowMs: 60_000, max: 20 }));
  app.use("/api/auctions/*/confirm", rateLimit({ windowMs: 60_000, max: 20 }));

  const serverKey = config.serverKey ?? process.env.SERVER_PRIVATE_KEY;
  const serverPubkey = getServerPubkey(serverKey);
  if (!serverPubkey) {
    console.warn(
      "WARNING: server signing key is not set — the server cannot co-sign or verify bids. " +
        "Set SERVER_PRIVATE_KEY (Node) / the SERVER_PRIVATE_KEY binding (Worker).",
    );
  }

  app.get("/health", (c) => c.json({ ok: true, pubkey: serverPubkey }));

  app.route("/api", createAuctionRoutes(db, { ...config, serverKey }));

  return app;
}
