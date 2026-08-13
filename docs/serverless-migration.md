# Serverless migration plan (Cloudflare D1)

Status: **not started** — this is an evaluation and step-by-step plan. The app
currently runs on Node (Hono + better-sqlite3 + SQLite). This plan describes
moving the API to Cloudflare Workers + D1 (+ R2 for images later) and the web
app to Vercel, per ROADMAP #2.

## Why it's a real project (not a quick change)

The blocking piece is the **data layer**, not the HTTP layer:

| Concern | Today | On Workers |
|---------|-------|------------|
| Hono | ✓ | ✓ (Workers-native) |
| SQL | better-sqlite3 (synchronous API) | **D1 (asynchronous API)** |
| Db interface | `getAuction()`, `saveBid()` … all synchronous | all methods must become async |
| Scheduler | `setInterval` + in-process per-auction lock (`auction-lock.ts`) | **Cron Trigger** or Durable Object alarms; the in-process `Map` lock does not work across isolates |
| Native module | better-sqlite3 | none (D1 is a managed service) |

Every route, `processBid`, `claim`, and the scheduler currently call the Db
synchronously. Converting the Db interface to async ripples through the whole
server — that is the core of the work.

## Recommended approach: a portable async Db interface

1. **Make the Db interface async** (`apps/server/src/db/index.ts`):
   `Promise<T>` return types on all methods. Implement it once over
   better-sqlite3 (wrap in `async`/`Promise.resolve`) so the local dev server
   keeps working, and again over the D1 binding (`env.DB`).
2. **Switch Hono to the Workers entry** (`export default { fetch }`) with a
   `D1Database` binding; keep the Node entry for local dev (both import the
   same routes).
3. **Scheduler**: move settle/anti-sniping to a **Cron Trigger** (one run per
   minute) or a Durable Object with alarms; the per-auction lock must become a
   D1 transaction (`BEGIN IMMEDIATE`-style via `db.batch`) or a DO per
   auction. Decide: DO-per-auction is the cleanest match for
   `withAuctionLock`.
4. **Migrations**: D1 is schema-first (`wrangler d1 migrations apply`); port
   the idempotent ALTERs from `initDb()` into numbered migration files.
   `bid_proofs`, `change_returns`, `fees` tables all carry over as-is.
5. **Secrets**: `NOSTR_PRIVATE_KEY` → Workers secret. `/health` pubkey is
   derived the same way.
6. **Images (R2)** — follow-up: uploads via `PUT` to a signed R2 URL, store the
   URL in `auctions.image`; requires a small web form change (currently
   external URLs only).

## Step-by-step

1. [x] Refactor `Db` to async; keep better-sqlite3 implementation; run the
      existing server tests unchanged (they call the same methods, now async).
      — done (2026-08-13, commit 76e0810)
2. [x] Add `wrangler.jsonc` + `src/worker.ts` Workers entry with a D1 binding;
      implement `D1Db` against the same interface; local dev via `wrangler dev`.
      — done (2026-08-13): Worker serves /health, listing create/list, and
      bid acceptance against a local D1 (miniflare); env injected via config
      (`createApp(db, { serverKey, feeBps })`).
3. [ ] Replace the scheduler with a Cron Trigger / Durable Object; port the
      settle logic; rework `withAuctionLock` (DO or transactions).
4. [ ] Port DB schema to D1 migrations; add `wrangler d1 migrations apply`.
5. [ ] Deploy web to Vercel (set `NEXT_PUBLIC_API_URL` to the worker URL);
      keep `SSR_API_URL` pointing at the worker.
6. [ ] (later) R2 image uploads.

## Risks / notes

- The async refactor touches every server file — do it as one focused PR with
  the full test suite as the safety net (95 server tests today).
- D1 has a 5-second write-per-transaction limit; auction settlement is a small
  number of writes, fine.
- The `withAuctionLock` Map is the only shared mutable state in the server;
  every other cross-request state lives in the DB, so the async refactor is
  mechanical, not architectural — except the lock, which must become D1
  transactional or DO-based.
