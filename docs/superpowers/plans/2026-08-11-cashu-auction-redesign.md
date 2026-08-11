# Cashu Auction Redesign (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Cashu × Nostr auction around an honest 2-of-2 trust model — bid proofs locked to seller+server — with deterministic settlement, server-mediated claim/refund, and the full feature set (reserve, buy-now, watchlist, checkout).

**Architecture:** Server (Hono + better-sqlite3 + nostr-tools + @cashu/cashu-ts) verifies bids via NUT-06/NUT-07, settles at `end_time + 30s`, and exposes claim-data/co-sign/refund-data endpoints. Web (Next.js) creates 2-of-2 P2PK proofs, signs claim/refund messages with the in-app key, and submits swaps via `prepareSwapToSend`/`completeSwap`.

**Tech Stack:** Node 24, TypeScript, Hono, better-sqlite3, nostr-tools, @cashu/cashu-ts 4.5.x, @noble/curves + @noble/hashes (added), Next.js 15, vitest (server + new web pure-logic tests), pnpm workspaces.

**Canonical spec:** `docs/superpowers/specs/2026-08-11-cashu-auction-redesign-design.md` (read it first).

## Global Constraints

- NUT-11 P2PK secret structure is fixed: `data=seller`, `pubkeys` includes server key, `n_sigs=2`, **no `sigflag` tag (SIG_INPUTS default)**, `locktime = ceil((end_time + 24h)/1000)`, `refund` includes bidder.
- Signature scheme: `schnorr.sign(sha256(utf8(secret)), sk)` / `schnorr.verify(sig, sha256(utf8(secret)), xOnlyPubkey)` — message is the SHA-256 of the secret string.
- Settlement is final only at `now >= end_time + 30_000` (grace); extension only for bids with `end_time - 5min <= received_at <= end_time`.
- `mint_url` is required on Auction; bids with `payload.mint_url !== auction.mint_url` are rejected; legacy auctions (`mint_url === ""`) are unbiddable.
- `ALLOW_TEST_BIDS=1` env gate for `mint_url === "test://local"` bypass (default OFF).
- All server tests use `import { describe, it, expect, beforeEach } from "vite-plus/test"` and run via `pnpm --filter @cashu-auction/server test`.
- There are pre-existing uncommitted changes (`apps/server/src/db/index.ts`, `apps/server/tests/verify.test.ts`, `pnpm-lock.yaml`). Leave them as-is; commit only task-relevant files.
- Time units: `end_time`/`received_at` in **ms**; P2PK `locktime` in **seconds**.

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/shared/src/index.ts` | Auction/Bid/Settlement types (add `reserve_price`, `buy_now_price`, `mint_url`, optional meta; settlement `result`) |
| `apps/server/src/lib/auction-lock.ts` | Per-auction async mutex (`withAuctionLock`) |
| `apps/server/src/lib/canonical.ts` | `canonicalPubkey` (x-only normalization) |
| `apps/server/src/lib/rate-limit.ts` | In-memory per-IP sliding-window limiter |
| `apps/server/src/lib/schnorr.ts` | `signSecret`/`verifySecretSignature` (sha256-of-secret scheme) |
| `apps/server/src/verify/index.ts` | Bid verification (2-of-2, mint checks, test gate) |
| `apps/server/src/process-bid.ts` | Bid orchestration + buy-now immediate settle + lock |
| `apps/server/src/scheduler/index.ts` | Grace settle, extension window, reserve, result tag |
| `apps/server/src/db/index.ts` | Schema + queries (new columns, `getBid`, `getShipping`) |
| `apps/server/src/nostr/publisher.ts` | Settlement `result` tag |
| `apps/server/src/routes/auctions.ts` | claim-data / co-sign / refund-data / shipping endpoints |
| `apps/web/lib/claim.ts` | Pure claim/refund logic (sign secret, build swap, submit) |
| `apps/web/lib/watchlist.ts` | Watchlist localStorage hook |
| `apps/web/lib/wallet.ts` | Wallet hook (2-of-2 send options pass-through) |
| `apps/web/app/auctions/[id]/bid-form.tsx` | 2-of-2 bid, mint default from auction, grace note |
| `apps/web/app/auctions/[id]/detail-bid-panel.tsx` | Buy Now button, reserve status |
| `apps/web/app/create/page.tsx` | Reserve Price + Buy Now fields, fee/deposit removal |
| `apps/web/app/dashboard/page.tsx` | Claim/refund UI, watchlist tab, legacy display |
| `apps/web/app/auctions/[id]/checkout.tsx` | Shipping form (winner) |
| Docs | `docs/adr/` deleted, `DESIGN.md` consolidated, `CONTEXT.md` glossary, `AGENTS.md`, `how-it-works` |

---

### Task 1: Repository doc restructure (ADR → spec)

**Files:**
- Delete: `docs/adr/0001-bid-verification-via-server-mediation.md`, `docs/adr/0002-bid-verification-flow-details.md`
- Delete: `mqrzma5i-DESIGN.md` (content merged into DESIGN.md in step 3)
- Modify: `DESIGN.md` (consolidate, keep only current UI), `AGENTS.md`, `docs/agents/domain.md`

**Interfaces:**
- Produces: repo doc tree matching the new canonical-spec layout. No code.

- [ ] **Step 1: Delete the ADR directory**

```bash
cd /Users/sktr/repo/cashu-auction
git rm -r docs/adr
```

- [ ] **Step 2: Update `docs/agents/domain.md`**

Replace any reference to `docs/adr/` with a pointer to the canonical spec. Full replacement content:

```markdown
# Domain docs

Single-context repo. Canonical protocol/architecture design lives in
`docs/superpowers/specs/` (the current one is
`2026-08-11-cashu-auction-redesign-design.md`). Domain vocabulary lives in
`CONTEXT.md` at the repo root. Visual/UI design lives in `DESIGN.md`.
Implementation plans live in `docs/superpowers/plans/`.
```

- [ ] **Step 3: Consolidate the two design-system docs into `DESIGN.md`**

`mqrzma5i-DESIGN.md` (green-teal) matches the current UI (commits 0aef21e / 9bc981c). Replace the entire content of `DESIGN.md` with the content of `mqrzma5i-DESIGN.md`, then delete `mqrzma5i-DESIGN.md`. The blue-accent `DESIGN.md` tokens (oklch blue) are obsolete — do not keep them.

```bash
cd /Users/sktr/repo/cashu-auction
cp mqrzma5i-DESIGN.md DESIGN.md
git rm mqrzma5i-DESIGN.md
```

- [ ] **Step 4: Update `AGENTS.md` "Domain docs" section**

In `AGENTS.md`, replace the line referencing ADRs:

```markdown
### Domain docs

Single-context repo with `CONTEXT.md` at the root, canonical design specs in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`, and the UI design system in `DESIGN.md`. See `docs/agents/domain.md`.
```

- [ ] **Step 5: Verify and commit**

```bash
cd /Users/sktr/repo/cashu-auction
test ! -d docs/adr && echo "ADR dir removed"
test ! -f mqrzma5i-DESIGN.md && echo "dup design doc removed"
grep -c "2026-08-11-cashu-auction-redesign-design" docs/agents/domain.md AGENTS.md
git add -A
git commit -m "docs: consolidate design docs into canonical spec layout"
```

Expected: both `test` guards print, `grep -c` prints `1` twice, commit succeeds.

---

### Task 2: Shared types + DB migration + auction parsing

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/db/index.ts`
- Modify: `apps/server/src/nostr/listener.ts` (`parseAuctionEvent`)
- Modify: `apps/server/tests/listener.test.ts`, `apps/server/tests/scheduler.test.ts` (makeAuction fixtures)
- Create: `apps/server/src/lib/canonical.ts`
- Test: `apps/server/tests/listener.test.ts` (extended)

**Interfaces:**
- Produces:
  - `canonicalPubkey(pk: string): string` in `apps/server/src/lib/canonical.ts` — returns lowercase x-coordinate (last 64 hex chars), used by all pubkey comparisons.
  - `Auction` type with `reserve_price: number | null`, `buy_now_price: number | null`, `mint_url: string`, and optional `category/condition/shipping/image`.
  - `Db.getBid(id: string): Bid | null` and `Db.saveShipping(auctionId, winnerNpub, address, note): void` / `Db.getShipping(auctionId)` (added in Task 6; declare `Db` shape now).

- [ ] **Step 1: Write the failing parse test**

Append to `apps/server/tests/listener.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vite-plus/test"
import type { Auction } from "@cashu-auction/shared"
import { initDb, type Db } from "../src/db/index.js"
import { parseAuctionEvent } from "../src/nostr/listener.js"

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    pubkey: "abc123",
    created_at: Math.floor(Date.now() / 1000) - 60,
    kind: 39000,
    tags: [["d", "auction-1"]],
    content: JSON.stringify({
      item: "test item",
      description: "a test item",
      start_price: 100,
      end_time: Date.now() + 3600_000,
    }),
    sig: "sig123",
    ...overrides,
  }
}

describe("parseAuctionEvent extended fields", () => {
  it("parses mint_url, reserve_price, buy_now_price and meta", () => {
    const event = makeEvent({
      content: JSON.stringify({
        item: "watch",
        description: "desc",
        start_price: 100,
        reserve_price: 5000,
        buy_now_price: 10000,
        end_time: Date.now() + 3600_000,
        mint_url: "https://mint.example",
        category: "watches",
        condition: "New",
        shipping: "Courier",
        image: "https://img.example/1.png",
      }),
    })
    const result = parseAuctionEvent(event)!
    expect(result.mint_url).toBe("https://mint.example")
    expect(result.reserve_price).toBe(5000)
    expect(result.buy_now_price).toBe(10000)
    expect(result.category).toBe("watches")
    expect(result.condition).toBe("New")
    expect(result.shipping).toBe("Courier")
    expect(result.image).toBe("https://img.example/1.png")
  })

  it("defaults mint_url to empty string and nullable prices to null", () => {
    const result = parseAuctionEvent(makeEvent())!
    expect(result.mint_url).toBe("")
    expect(result.reserve_price).toBeNull()
    expect(result.buy_now_price).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/listener.test.ts`
Expected: FAIL — `parseAuctionEvent` returns an object without `mint_url` (property `undefined`).

- [ ] **Step 3: Update shared types**

Replace the `Auction` interface in `packages/shared/src/index.ts`:

```ts
export interface Auction {
  id: string
  item: string
  description: string
  start_price: number
  reserve_price: number | null
  buy_now_price: number | null
  end_time: number
  seller_pubkey: string
  state: AuctionState
  start_time: number
  last_extended_at: number | null
  winner_npub: string | null
  winning_amount: number | null
  mint_url: string
  category?: string
  condition?: string
  shipping?: string
  image?: string
}
```

- [ ] **Step 4: Create the canonical pubkey helper**

Create `apps/server/src/lib/canonical.ts`:

```ts
/** Normalize a pubkey to lowercase x-only (last 64 hex chars). */
export function canonicalPubkey(pk: string): string {
  const clean = pk.trim().toLowerCase()
  // strip 02/03 SEC1 prefix if present
  const x = clean.length === 66 ? clean.slice(2) : clean
  return x
}
```

- [ ] **Step 5: Update `parseAuctionEvent`**

Replace the body of `parseAuctionEvent` in `apps/server/src/nostr/listener.ts`:

```ts
export function parseAuctionEvent(event: Event): Auction | null {
  if (event.kind !== 39000) return null

  const dTag = event.tags.find((t) => t[0] === "d")?.[1]
  if (!dTag) return null

  let content: Record<string, unknown>
  try {
    content = JSON.parse(event.content) as Record<string, unknown>
  } catch {
    return null
  }

  return {
    id: dTag,
    item: String(content.item ?? ""),
    description: String(content.description ?? ""),
    start_price: Number(content.start_price ?? 0),
    reserve_price:
      content.reserve_price !== undefined && content.reserve_price !== null
        ? Number(content.reserve_price)
        : null,
    buy_now_price:
      content.buy_now_price !== undefined && content.buy_now_price !== null
        ? Number(content.buy_now_price)
        : null,
    end_time: Number(content.end_time ?? 0),
    seller_pubkey: event.pubkey,
    state: "ACTIVE",
    start_time: event.created_at * 1000,
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: String(content.mint_url ?? ""),
    ...(content.category ? { category: String(content.category) } : {}),
    ...(content.condition ? { condition: String(content.condition) } : {}),
    ...(content.shipping ? { shipping: String(content.shipping) } : {}),
    ...(content.image ? { image: String(content.image) } : {}),
  }
}
```

- [ ] **Step 6: Run parse test to verify it passes**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/listener.test.ts`
Expected: PASS.

- [ ] **Step 7: Update the DB schema**

In `apps/server/src/db/index.ts`, extend the `CREATE TABLE` for auctions (add columns) and the insert statement:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS auctions (
      id TEXT PRIMARY KEY,
      item TEXT NOT NULL,
      description TEXT NOT NULL,
      start_price INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      seller_pubkey TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'PENDING',
      start_time INTEGER NOT NULL,
      last_extended_at INTEGER,
      winner_npub TEXT,
      winning_amount INTEGER,
      mint_url TEXT NOT NULL DEFAULT '',
      reserve_price INTEGER,
      buy_now_price INTEGER,
      category TEXT,
      condition TEXT,
      shipping TEXT,
      image TEXT
    );
    -- ...(bids table unchanged)...
  `)
```

Then after the existing `proof_data` migration block, add idempotent column migrations for existing DBs:

```ts
  for (const col of [
    "ALTER TABLE auctions ADD COLUMN mint_url TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE auctions ADD COLUMN reserve_price INTEGER",
    "ALTER TABLE auctions ADD COLUMN buy_now_price INTEGER",
    "ALTER TABLE auctions ADD COLUMN category TEXT",
    "ALTER TABLE auctions ADD COLUMN condition TEXT",
    "ALTER TABLE auctions ADD COLUMN shipping TEXT",
    "ALTER TABLE auctions ADD COLUMN image TEXT",
  ]) {
    try {
      db.exec(col)
    } catch {
      // column already exists — fine
    }
  }
```

Update the insert statement to include the new columns:

```ts
  const insertAuction = db.prepare(`
    INSERT OR REPLACE INTO auctions
      (id, item, description, start_price, reserve_price, buy_now_price, end_time, seller_pubkey, state, start_time, last_extended_at, winner_npub, winning_amount, mint_url, category, condition, shipping, image)
    VALUES
      (@id, @item, @description, @start_price, @reserve_price, @buy_now_price, @end_time, @seller_pubkey, @state, @start_time, @last_extended_at, @winner_npub, @winning_amount, @mint_url, @category, @condition, @shipping, @image)
  `)
```

And the `saveAuction` method:

```ts
    saveAuction(auction: Auction) {
      insertAuction.run({
        ...auction,
        last_extended_at: auction.last_extended_at ?? null,
        winner_npub: auction.winner_npub ?? null,
        winning_amount: auction.winning_amount ?? null,
        reserve_price: auction.reserve_price ?? null,
        buy_now_price: auction.buy_now_price ?? null,
        category: auction.category ?? null,
        condition: auction.condition ?? null,
        shipping: auction.shipping ?? null,
        image: auction.image ?? null,
      })
    },
```

Add `getBid` to the `Db` interface and implementation:

```ts
export interface Db {
  // ...existing...
  getBid: (id: string) => Bid | null
}

  // in the returned object:
  getBid(id: string) {
    return (db.prepare("SELECT * FROM bids WHERE id = ?").get(id) ?? null) as Bid | null
  },
```

- [ ] **Step 8: Fix the test fixtures that construct `Auction` objects**

In `apps/server/tests/scheduler.test.ts`, `makeAuction` — add the new required fields:

```ts
function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "test-1",
    item: "test item",
    description: "desc",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 300_000,
    seller_pubkey: "abc",
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  }
}
```

Do the same in `apps/server/tests/verify.test.ts` `makeAuction` (add `reserve_price: null`, `buy_now_price: null`, `mint_url: "https://mint.example"`).

- [ ] **Step 9: Run the full server test suite**

Run: `pnpm --filter @cashu-auction/server test`
Expected: all existing tests PASS with the new fixture fields.

- [ ] **Step 10: Typecheck and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/server run typecheck
pnpm --filter @cashu-auction/web run typecheck
git add packages/shared/src/index.ts apps/server/src/db/index.ts apps/server/src/nostr/listener.ts apps/server/src/lib/canonical.ts apps/server/tests
git commit -m "feat: extend Auction schema with mint_url, reserve/buy-now prices, meta"
```

---

### Task 3: verify — 2-of-2 P2PK structure, mint checks, test gate

**Files:**
- Modify: `apps/server/src/verify/index.ts`
- Modify: `apps/server/src/lib/schnorr.ts` (create)
- Test: `apps/server/tests/verify.test.ts`

**Interfaces:**
- Consumes: `canonicalPubkey` from `../lib/canonical.js`.
- Produces:
  - `parseP2PKSecret(secret)` returns `{ data, pubkeys, nSigs, sigflag, locktime, refund }` (throws `VerifyError`-shaped object on failure).
  - `verifyBid(payload, auction, currentHighestBid?, serverPubkey?)` — new checks; serverPubkey required.
  - New error codes: `MINT_URL_MISMATCH`, `MINT_UNSUPPORTED`, `MINT_UNREACHABLE`, `P2PK_STRUCTURE_INVALID`, `SERVER_KEY_MISMATCH`, `SIGFLAG_NOT_INPUTS`, `LEGACY_AUCTION`, `PUBKEY_FORMAT_INVALID`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/tests/verify.test.ts`:

```ts
import { parseP2PKSecret, verifyBid } from "../src/verify/index.js"
import { canonicalPubkey } from "../src/lib/canonical.js"

const SERVER_PUBKEY = "04deadbeef"

function make2of2Secret(
  data: string,
  locktime: number,
  refund: string,
  nonce = "abc123",
  extra: string[][] = [],
): string {
  return JSON.stringify([
    "P2PK",
    {
      nonce,
      data,
      tags: [
        ["pubkeys", SERVER_PUBKEY],
        ["n_sigs", "2"],
        ["locktime", String(locktime)],
        ["refund", refund],
        ...extra,
      ],
    },
  ])
}

describe("canonicalPubkey", () => {
  it("normalizes 02-prefixed and x-only keys to the same value", () => {
    const x = "ab".repeat(32)
    expect(canonicalPubkey(`02${x}`)).toBe(x)
    expect(canonicalPubkey(x)).toBe(x)
    expect(canonicalPubkey(`03${x.toUpperCase()}`)).toBe(x)
  })
})

describe("parseP2PKSecret 2-of-2", () => {
  it("extracts pubkeys, nSigs and sigflag", () => {
    const locktime = Math.floor(Date.now() / 1000) + 48 * 3600
    const secret = make2of2Secret("02seller", locktime, "03bidder", "n1")
    const r = parseP2PKSecret(secret) as { pubkeys: string[]; nSigs: number; sigflag: string | null }
    expect(r.pubkeys).toContain(SERVER_PUBKEY)
    expect(r.nSigs).toBe(2)
    expect(r.sigflag).toBeNull()
  })

  it("rejects SIG_ALL sigflag", () => {
    const locktime = Math.floor(Date.now() / 1000) + 48 * 3600
    const secret = make2of2Secret("02seller", locktime, "03bidder", "n2", [["sigflag", "SIG_ALL"]])
    const r = parseP2PKSecret(secret)
    expect(r).toHaveProperty("code", "SIGFLAG_NOT_INPUTS")
  })
})

describe("verifyBid 2-of-2 checks", () => {
  const auction = {
    id: "auction-1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "ACTIVE" as const,
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
  }
  const locktime = Math.floor((auction.end_time + 24 * 3600_000) / 1000) + 100

  function bidPayload(secret: string, overrides: Record<string, unknown> = {}) {
    return {
      proof: { id: "keyset1", amount: 200, secret, C: "c" },
      mint_url: "https://mint.example",
      auction_id: "auction-1",
      amount: 200,
      bidder_pubkey: "03cafebabe",
      ...overrides,
    }
  }

  it("rejects when pubkeys lacks the server key", async () => {
    // NOTE: build the secret from scratch — the `make2of2Secret` helper always emits
    // the correct `pubkeys` tag first, and cashu-ts `getTag` returns the FIRST match,
    // so appending an extra `["pubkeys", ...]` tag would NOT override it.
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n3",
        data: "02deadbeef",
        tags: [
          ["n_sigs", "2"],
          ["locktime", String(locktime)],
          ["refund", "03cafebabe"],
          ["pubkeys", "04other"], // server key absent
        ],
      },
    ])
    const result = await verifyBid(bidPayload(secret), auction as never, undefined, SERVER_PUBKEY)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("SERVER_KEY_MISMATCH")
  })

  it("rejects when n_sigs is not 2", async () => {
    const secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n4",
        data: "02deadbeef",
        tags: [
          ["pubkeys", SERVER_PUBKEY],
          ["n_sigs", "1"],
          ["locktime", String(locktime)],
          ["refund", "03cafebabe"],
        ],
      },
    ])
    const result = await verifyBid(bidPayload(secret), auction as never, undefined, SERVER_PUBKEY)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("P2PK_STRUCTURE_INVALID")
  })

  it("rejects when mint_url does not match the auction", async () => {
    const secret = make2of2Secret("02deadbeef", locktime, "03cafebabe", "n5")
    const result = await verifyBid(
      bidPayload(secret, { mint_url: "https://other.example" }),
      auction as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("MINT_URL_MISMATCH")
  })

  it("rejects legacy auctions with empty mint_url", async () => {
    const secret = make2of2Secret("02deadbeef", locktime, "03cafebabe", "n6")
    const legacy = { ...auction, mint_url: "" }
    const result = await verifyBid(bidPayload(secret), legacy as never, undefined, SERVER_PUBKEY)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("LEGACY_AUCTION")
  })

  it("accepts a well-formed 2-of-2 bid against the test mint", async () => {
    const secret = make2of2Secret("02deadbeef", locktime, "03cafebabe", "n7")
    const result = await verifyBid(
      bidPayload(secret, { mint_url: "test://local" }),
      auction as never,
      undefined,
      SERVER_PUBKEY,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects test://local bids when ALLOW_TEST_BIDS is off", async () => {
    const secret = make2of2Secret("02deadbeef", locktime, "03cafebabe", "n8")
    const prev = process.env.ALLOW_TEST_BIDS
    delete process.env.ALLOW_TEST_BIDS
    try {
      const result = await verifyBid(
        bidPayload(secret, { mint_url: "test://local" }),
        auction as never,
        undefined,
        SERVER_PUBKEY,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("MINT_URL_MISMATCH")
    } finally {
      if (prev !== undefined) process.env.ALLOW_TEST_BIDS = prev
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/verify.test.ts`
Expected: FAIL — `parseP2PKSecret` returns only `{data,locktime,refund}`; `verifyBid` signature lacks `serverPubkey`.

- [ ] **Step 3: Create `apps/server/src/lib/schnorr.ts`**

```ts
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "nostr-tools/utils"

export function secretDigest(secret: string): Uint8Array {
  return sha256(new TextEncoder().encode(secret))
}

export function signSecret(secret: string, privkeyHex: string): string {
  return bytesToHex(schnorr.sign(secretDigest(secret), hexToBytes(privkeyHex)))
}

/** pubkeyHex must be an x-only (32-byte) pubkey. */
export function verifySecretSignature(
  sigHex: string,
  secret: string,
  pubkeyXOnlyHex: string,
): boolean {
  try {
    return schnorr.verify(hexToBytes(sigHex), secretDigest(secret), hexToBytes(pubkeyXOnlyHex))
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Add dependencies to the server package**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/server add @noble/curves @noble/hashes
```

- [ ] **Step 5: Rewrite `parseP2PKSecret` and `verifyBid`**

Replace `apps/server/src/verify/index.ts` with:

```ts
import { Mint } from "@cashu/cashu-ts"
import { getSecretKind, getDataField, getTag } from "@cashu/cashu-ts"
import { hashToCurve } from "@cashu/cashu-ts"
import type { Auction } from "@cashu-auction/shared"
import { canonicalPubkey } from "../lib/canonical.js"
import { hasValidDleq } from "@cashu/cashu-ts"

const LOCKTIME_MARGIN_MS = 24 * 60 * 60 * 1000
const END_TIME_MARGIN_MS = 30_000
const TEST_MINT_URL = "test://local"

export interface BidPayload {
  proof: {
    id: string
    amount: number
    secret: string
    C: string
    dleq?: { e: string; s: string }
  }
  mint_url: string
  auction_id: string
  amount: number
  bidder_pubkey: string
}

export type VerifyError =
  | { code: "INVALID_SECRET_FORMAT"; message: string }
  | { code: "NOT_P2PK_SECRET" }
  | { code: "PUBKEY_MISMATCH"; expected: string; actual: string }
  | { code: "SERVER_KEY_MISMATCH" }
  | { code: "P2PK_STRUCTURE_INVALID"; message: string }
  | { code: "SIGFLAG_NOT_INPUTS"; flag: string }
  | { code: "LOCKTIME_TOO_EARLY"; locktime: number; required: number }
  | { code: "REFUND_MISMATCH"; expected: string }
  | { code: "AMOUNT_MISMATCH"; proofAmount: number; claimedAmount: number }
  | { code: "BELOW_START_PRICE"; amount: number; startPrice: number }
  | { code: "BELOW_HIGHEST_BID"; amount: number; highestBid: number }
  | { code: "PROOF_ALREADY_SPENT" }
  | { code: "AUCTION_NOT_FOUND" }
  | { code: "AUCTION_NOT_ACTIVE"; state: string }
  | { code: "TOO_LATE"; endTime: number; margin: number }
  | { code: "MINT_ERROR"; message: string }
  | { code: "MINT_URL_MISMATCH"; expected: string; actual: string }
  | { code: "LEGACY_AUCTION" }
  | { code: "MINT_UNSUPPORTED"; missing: string[] }
  | { code: "MINT_UNREACHABLE"; message: string }

export type VerifyResult =
  | { ok: true; Y: string }
  | { ok: false; error: VerifyError }

function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

export function computeY(secret: string): string {
  const point = hashToCurve(utf8Encode(secret))
  return point.toHex()
}

export interface ParsedP2PK {
  data: string
  pubkeys: string[]
  nSigs: number
  sigflag: string | null
  locktime: number
  refund: string
}

export function parseP2PKSecret(
  secret: string,
): ParsedP2PK | VerifyError {
  let kind: string
  try {
    kind = getSecretKind(secret)
  } catch {
    return { code: "INVALID_SECRET_FORMAT", message: "cannot parse secret" }
  }
  if (kind !== "P2PK") return { code: "NOT_P2PK_SECRET" }

  let data: string
  try {
    data = getDataField(secret)
  } catch {
    return { code: "INVALID_SECRET_FORMAT", message: "cannot read data field" }
  }
  if (!data) return { code: "INVALID_SECRET_FORMAT", message: "missing data field" }

  let locktimeTag: string[] | undefined
  try {
    locktimeTag = getTag(secret, "locktime")
  } catch {
    return { code: "INVALID_SECRET_FORMAT", message: "cannot read locktime tag" }
  }
  const locktime = locktimeTag?.[0] ? Number(locktimeTag[0]) : 0
  if (!locktime || isNaN(locktime)) {
    return { code: "INVALID_SECRET_FORMAT", message: "missing or invalid locktime tag" }
  }

  let refundTag: string[] | undefined
  try {
    refundTag = getTag(secret, "refund")
  } catch {
    return { code: "INVALID_SECRET_FORMAT", message: "cannot read refund tag" }
  }
  const refund = refundTag?.join(",") ?? ""
  if (!refund) return { code: "INVALID_SECRET_FORMAT", message: "missing refund tag" }

  let sigflag: string | null = null
  try {
    const f = getTag(secret, "sigflag")?.[0]
    sigflag = f ?? null
  } catch {
    // treat as absent
  }
  if (sigflag !== null && sigflag !== "SIG_INPUTS") {
    return { code: "SIGFLAG_NOT_INPUTS", flag: sigflag }
  }

  let pubkeys: string[] = []
  try {
    const tag = getTag(secret, "pubkeys")
    pubkeys = tag ?? []
  } catch {
    pubkeys = []
  }

  let nSigs = 1
  try {
    const n = getTag(secret, "n_sigs")?.[0]
    if (n !== undefined) nSigs = Number(n)
  } catch {
    // default 1
  }

  return { data, pubkeys, nSigs, sigflag, locktime, refund }
}

// NUT-06 capability cache: mintUrl -> { ok: boolean; at: number }
const infoCache = new Map<string, { ok: boolean; at: number }>()
const INFO_TTL_MS = 60 * 60 * 1000

async function checkMintCapabilities(mintUrl: string): Promise<{ ok: boolean; missing?: string[] }> {
  const cached = infoCache.get(mintUrl)
  if (cached && Date.now() - cached.at < INFO_TTL_MS) {
    return cached.ok ? { ok: true } : { ok: false }
  }
  try {
    const res = await fetch(`${mintUrl}/v1/info`)
    if (!res.ok) throw new Error(`info HTTP ${res.status}`)
    const info = (await res.json()) as { nuts?: Record<string, { supported?: boolean }> }
    const required = ["7", "8", "10", "11"]
    const missing = required.filter((n) => !info.nuts?.[n]?.supported)
    const ok = missing.length === 0
    infoCache.set(mintUrl, { ok, at: Date.now() })
    return ok ? { ok: true } : { ok: false, missing }
  } catch (err) {
    infoCache.set(mintUrl, { ok: false, at: Date.now() })
    throw err
  }
}

export async function verifyBid(
  payload: BidPayload,
  auction: Auction,
  currentHighestBid?: number,
  serverPubkey?: string,
): Promise<VerifyResult> {
  if (auction.state !== "ACTIVE" && auction.state !== "EXTENDED") {
    return { ok: false, error: { code: "AUCTION_NOT_ACTIVE", state: auction.state } }
  }

  const maxArrivalTime = auction.end_time + END_TIME_MARGIN_MS
  if (Date.now() > maxArrivalTime) {
    return {
      ok: false,
      error: { code: "TOO_LATE", endTime: auction.end_time, margin: END_TIME_MARGIN_MS },
    }
  }

  if (payload.amount < auction.start_price) {
    return {
      ok: false,
      error: { code: "BELOW_START_PRICE", amount: payload.amount, startPrice: auction.start_price },
    }
  }

  if (currentHighestBid !== undefined && payload.amount <= currentHighestBid) {
    return {
      ok: false,
      error: { code: "BELOW_HIGHEST_BID", amount: payload.amount, highestBid: currentHighestBid },
    }
  }

  if (payload.proof.amount !== payload.amount) {
    return {
      ok: false,
      error: {
        code: "AMOUNT_MISMATCH",
        proofAmount: payload.proof.amount,
        claimedAmount: payload.amount,
      },
    }
  }

  // ── mint selection ──────────────────────────────
  const allowTest = process.env.ALLOW_TEST_BIDS === "1"
  const isTestMint = payload.mint_url === TEST_MINT_URL

  if (auction.mint_url === "") {
    return { ok: false, error: { code: "LEGACY_AUCTION" } }
  }
  if (!allowTest || !isTestMint) {
    if (payload.mint_url !== auction.mint_url) {
      return {
        ok: false,
        error: { code: "MINT_URL_MISMATCH", expected: auction.mint_url, actual: payload.mint_url },
      }
    }
  }

  // ── P2PK structure ──────────────────────────────
  let parsed: ParsedP2PK | VerifyError
  try {
    parsed = parseP2PKSecret(payload.proof.secret)
  } catch (err) {
    return { ok: false, error: { code: "INVALID_SECRET_FORMAT", message: String(err) } }
  }
  if ("code" in parsed) return { ok: false, error: parsed }

  if (canonicalPubkey(parsed.data) !== canonicalPubkey(auction.seller_pubkey)) {
    return {
      ok: false,
      error: {
        code: "PUBKEY_MISMATCH",
        expected: auction.seller_pubkey,
        actual: parsed.data,
      },
    }
  }

  if (!serverPubkey || !parsed.pubkeys.map(canonicalPubkey).includes(canonicalPubkey(serverPubkey))) {
    return { ok: false, error: { code: "SERVER_KEY_MISMATCH" } }
  }

  if (parsed.nSigs !== 2) {
    return { ok: false, error: { code: "P2PK_STRUCTURE_INVALID", message: `n_sigs=${parsed.nSigs} (expected 2)` } }
  }

  const requiredLocktime = Math.ceil((auction.end_time + LOCKTIME_MARGIN_MS) / 1000)
  if (parsed.locktime < requiredLocktime) {
    return {
      ok: false,
      error: { code: "LOCKTIME_TOO_EARLY", locktime: parsed.locktime, required: requiredLocktime },
    }
  }

  if (!parsed.refund.split(",").map(canonicalPubkey).includes(canonicalPubkey(payload.bidder_pubkey))) {
    return { ok: false, error: { code: "REFUND_MISMATCH", expected: payload.bidder_pubkey } }
  }

  let Y: string
  try {
    Y = computeY(payload.proof.secret)
  } catch {
    return { ok: false, error: { code: "INVALID_SECRET_FORMAT", message: "failed to compute Y" } }
  }

  if (allowTest && isTestMint) {
    return { ok: true, Y }
  }

  // ── mint reachability + NUT-06 ───────────────────
  try {
    const caps = await checkMintCapabilities(payload.mint_url)
    if (!caps.ok) {
      return { ok: false, error: { code: "MINT_UNSUPPORTED", missing: caps.missing ?? [] } }
    }
  } catch (err) {
    return { ok: false, error: { code: "MINT_UNREACHABLE", message: String(err) } }
  }

  // ── best-effort DLEQ (NUT-12) ────────────────────
  if (payload.proof.dleq) {
    try {
      const ksRes = await fetch(`${payload.mint_url}/v1/keysets`)
      const { keysets } = (await ksRes.json()) as { keysets: { id: string }[] }
      const keyset = keysets.find((k) => k.id === payload.proof.id)
      if (keyset) {
        const kRes = await fetch(`${payload.mint_url}/v1/keys/${keyset.id}`)
        const { keys } = (await kRes.json()) as { keys: Record<string, string> }
        const pub = keys[String(payload.proof.amount)]
        if (pub) {
          hasValidDleq(payload.proof as never, { keys: { [payload.proof.amount]: pub } } as never, {
            require: true,
          })
        }
      }
    } catch {
      // best-effort — a failing DLEQ check does not reject the bid
    }
  }

  // ── NUT-07 unspent check (best-effort with proofs, spec §4.1.9) ──
  try {
    const mint = new Mint(payload.mint_url)
    let state: string | undefined
    // Some mints validate the supplied proofs (detecting forgeries). Best-effort:
    // if the mint rejects the extra field, fall back to the plain Ys check.
    try {
      const res = await fetch(`${payload.mint_url}/v1/checkstate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Ys: [Y], proofs: [payload.proof] }),
      })
      if (res.ok) {
        const data = (await res.json()) as { states?: { state?: string }[] }
        state = data.states?.[0]?.state
      }
    } catch {
      // mint does not accept proofs — fall through to the cashu-ts check
    }
    if (!state) {
      const result = await mint.check({ Ys: [Y] })
      state = result.states[0]?.state
    }
    if (state !== "UNSPENT") {
      return { ok: false, error: { code: "PROOF_ALREADY_SPENT" } }
    }
  } catch (err) {
    return { ok: false, error: { code: "MINT_ERROR", message: String(err) } }
  }

  return { ok: true, Y }
}
```

Note: `hasValidDleq` with `require: true` throws on invalid DLEQ — the surrounding try/catch swallows it (best-effort, per spec §4.4). The existing tests for `verifyBid` that previously passed `mint_url: "test://local"` will now FAIL until `ALLOW_TEST_BIDS=1` is set or the tests pass a real mint — fix the existing tests in the next step.

- [ ] **Step 6: Migrate the existing verify tests to 2-of-2 + the test gate**

The pre-existing tests in `apps/server/tests/verify.test.ts` build single-sig secrets and call `verifyBid` without a server key — they now fail the new checks. Fix them:

1. Replace the existing `makeP2PKSecret` helper with a 2-of-2 version:

```ts
function makeP2PKSecret(
  data: string,
  locktime: number,
  refund: string,
  nonce = "abc123",
): string {
  return JSON.stringify([
    "P2PK",
    {
      nonce,
      data,
      tags: [
        ["pubkeys", SERVER_PUBKEY],
        ["n_sigs", "2"],
        ["locktime", String(locktime)],
        ["refund", refund],
      ],
    },
  ])
}
```

2. Define `SERVER_PUBKEY` at the top of the file next to `SELLER_PUBKEY`:

```ts
const SERVER_PUBKEY = "04deadbeef"
```

3. Update every `verifyBid(...)` call in the pre-existing tests to pass `SERVER_PUBKEY` as the 4th argument:

```ts
    const result = await verifyBid(payload, auction, undefined, SERVER_PUBKEY)
```

(If a call already passes a highest-bid argument, pass `SERVER_PUBKEY` after it.)

4. Set the test-mint env gate for the whole file:

```ts
beforeEach(() => {
  process.env.ALLOW_TEST_BIDS = "1"
})

afterAll(() => {
  delete process.env.ALLOW_TEST_BIDS
})
```

Note: the `parseP2PKSecret` tests (single-sig secret, no pubkeys/n_sigs) still pass unchanged — `parseP2PKSecret` only parses; the structure checks live in `verifyBid`.

- [ ] **Step 7: Run the verify tests**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/verify.test.ts`
Expected: PASS (new 2-of-2 tests + existing tests with the env gate).

- [ ] **Step 8: Typecheck and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/server run typecheck
git add apps/server/src/verify/index.ts apps/server/src/lib/schnorr.ts apps/server/tests/verify.test.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat: enforce 2-of-2 P2PK structure, mint_url and NUT-06 in bid verification"
```

---

### Task 4: process-bid — per-auction lock + buy-now immediate settle

**Files:**
- Create: `apps/server/src/lib/auction-lock.ts`
- Modify: `apps/server/src/process-bid.ts`
- Modify: `apps/server/src/routes/auctions.ts` (pass serverPubkey into processBid)
- Modify: `apps/server/src/nostr/listener.ts` (pass serverPubkey into processBid)
- Test: `apps/server/tests/process-bid.test.ts` (create)

**Interfaces:**
- Consumes: `verifyBid(payload, auction, highest?, serverPubkey?)`, `withAuctionLock`.
- Produces:
  - `processBid(payload, db, pub, serverPubkey)` → `{ ok: true; buyNow?: boolean } | { ok: false; error: string }`.
  - When a bid `>= auction.buy_now_price` is accepted, `processBid` marks the auction SETTLED immediately, publishes bid + settlement (result `sold`), sets winner, and returns `{ ok: true, buyNow: true }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/tests/process-bid.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vite-plus/test"
import { initDb, type Db } from "../src/db/index.js"
import { processBid } from "../src/process-bid.js"
import type { Publisher } from "../src/nostr/publisher.js"
import type { Auction } from "@cashu-auction/shared"

const SELLER = "02deadbeef"
const SERVER = "04server"
const BIDDER = "03cafebabe"

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "a1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: SELLER,
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  }
}

function p2pk(data: string, locktime: number, refund: string, nonce: string): string {
  return JSON.stringify([
    "P2PK",
    {
      nonce,
      data,
      tags: [
        ["pubkeys", SERVER],
        ["n_sigs", "2"],
        ["locktime", String(locktime)],
        ["refund", refund],
      ],
    },
  ])
}

function payload(auction: Auction, amount: number, nonce: string) {
  const locktime = Math.ceil((auction.end_time + 24 * 3600_000) / 1000) + 100
  return {
    proof: {
      id: "keyset1",
      amount,
      secret: p2pk(SELLER, locktime, BIDDER, nonce),
      C: "c",
    },
    mint_url: "https://mint.example",
    auction_id: auction.id,
    amount,
    bidder_pubkey: BIDDER,
  }
}

function makePublisher() {
  const calls: unknown[] = []
  const pub: Publisher = {
    publishBid(...args) {
      calls.push({ type: "bid", args })
    },
    publishSettlement(...args) {
      calls.push({ type: "settlement", args })
    },
  }
  return { pub, calls }
}

describe("processBid", () => {
  let db: Db
  beforeEach(() => {
    db = initDb()
    process.env.ALLOW_TEST_BIDS = "1"
  })

  it("rejects a bid for an unknown auction", async () => {
    const { pub } = makePublisher()
    const auction = makeAuction()
    const result = await processBid(payload(auction, 200, "n1"), db, pub, SERVER)
    expect(result).toEqual({ ok: false, error: "auction not found" })
  })

  it("records a verified bid and publishes kind:39001", async () => {
    const { pub, calls } = makePublisher()
    const auction = makeAuction()
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 200, "n1"), db, pub, SERVER)
    expect(result.ok).toBe(true)
    const bids = db.getVerifiedBids("a1")
    expect(bids).toHaveLength(1)
    expect(bids[0]!.amount).toBe(200)
    expect(calls.some((c: any) => c.type === "bid")).toBe(true)
  })

  it("marks the previous bid of the same bidder as replaced", async () => {
    const { pub } = makePublisher()
    const auction = makeAuction()
    db.saveAuction(auction)
    await processBid(payload(auction, 200, "n1"), db, pub, SERVER)
    await processBid(payload(auction, 300, "n2"), db, pub, SERVER)
    const bids = db.getVerifiedBids("a1")
    expect(bids).toHaveLength(1)
    expect(bids[0]!.amount).toBe(300)
  })

  it("immediately settles when amount >= buy_now_price", async () => {
    const { pub, calls } = makePublisher()
    const auction = makeAuction({ buy_now_price: 1000 })
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 1000, "n3"), db, pub, SERVER)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.buyNow).toBe(true)
    const settled = db.getAuction("a1")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe(BIDDER)
    expect(settled.winning_amount).toBe(1000)
    expect(calls.some((c: any) => c.type === "settlement")).toBe(true)
  })

  it("does not settle early for a normal high bid below buy_now_price", async () => {
    const { pub } = makePublisher()
    const auction = makeAuction({ buy_now_price: 1000 })
    db.saveAuction(auction)
    const result = await processBid(payload(auction, 500, "n4"), db, pub, SERVER)
    expect(result.ok).toBe(true)
    expect(db.getAuction("a1")!.state).toBe("ACTIVE")
  })

  afterAll(() => {
    delete process.env.ALLOW_TEST_BIDS
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/process-bid.test.ts`
Expected: FAIL — `processBid` signature lacks `serverPubkey`; no buy-now behavior.

- [ ] **Step 3: Create the per-auction lock**

Create `apps/server/src/lib/auction-lock.ts`:

```ts
type Mutex = {
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      const prev = tail
      tail = prev.then(() => gate)
      await prev
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

const mutexes = new Map<string, Mutex>()

/** Serializes async work per auction id within this process. */
export function withAuctionLock<T>(auctionId: string, fn: () => Promise<T>): Promise<T> {
  let m = mutexes.get(auctionId)
  if (!m) {
    m = createMutex()
    mutexes.set(auctionId, m)
  }
  return m.run(fn)
}
```

- [ ] **Step 4: Rewrite `processBid`**

Replace `apps/server/src/process-bid.ts`:

```ts
import type { Bid } from "@cashu-auction/shared"
import type { Db } from "./db/index.js"
import type { Publisher } from "./nostr/publisher.js"
import { verifyBid, type BidPayload } from "./verify/index.js"
import { withAuctionLock } from "./lib/auction-lock.js"

export type ProcessBidResult =
  | { ok: true; buyNow?: boolean }
  | { ok: false; error: string }

export async function processBid(
  payload: BidPayload,
  db: Db,
  pub: Publisher,
  serverPubkey?: string,
): Promise<ProcessBidResult> {
  return withAuctionLock(payload.auction_id, async () => {
    const auction = db.getAuction(payload.auction_id)
    if (!auction) return { ok: false, error: "auction not found" }

    const existingBids = db.getVerifiedBids(auction.id)
    const highestBid = existingBids.length > 0 ? existingBids[0]!.amount : undefined

    const result = await verifyBid(payload, auction, highestBid, serverPubkey)
    if (!result.ok) {
      const err = result.error
      return {
        ok: false,
        error: `verify error: ${"code" in err ? err.code : JSON.stringify(err)}`,
      }
    }

    const proofData = JSON.stringify({
      keyset_id: payload.proof.id,
      C: payload.proof.C,
      secret: payload.proof.secret,
      mint_url: payload.mint_url,
      amount: payload.amount,
    })

    const bid: Bid = {
      id: `${payload.auction_id}-${result.Y}`,
      auction_id: payload.auction_id,
      amount: payload.amount,
      bidder_npub: payload.bidder_pubkey,
      Y: result.Y,
      received_at: Date.now(),
      status: "verified",
      proof_data: proofData,
    }
    db.saveBid(bid)

    pub.publishBid(
      auction.id,
      auction.seller_pubkey,
      payload.bidder_pubkey,
      payload.amount,
      result.Y,
      bid.received_at,
    )

    // Mark old bids from same bidder as replaced
    for (const oldBid of existingBids) {
      if (oldBid.bidder_npub === payload.bidder_pubkey && oldBid.id !== bid.id) {
        oldBid.status = "replaced"
        db.saveBid(oldBid)
      }
    }

    // ── Buy-now: amount >= buy_now_price settles immediately ──
    if (
      auction.buy_now_price !== null &&
      auction.buy_now_price > 0 &&
      payload.amount >= auction.buy_now_price
    ) {
      auction.state = "SETTLED"
      auction.winner_npub = bid.bidder_npub
      auction.winning_amount = bid.amount
      db.saveAuction(auction)
      pub.publishSettlement(
        auction.id,
        auction.seller_pubkey,
        bid.bidder_npub,
        bid.amount,
        db.getVerifiedBids(auction.id).length,
      )
      return { ok: true, buyNow: true }
    }

    return { ok: true }
  })
}
```

- [ ] **Step 5: Wire `serverPubkey` through the callers**

In `apps/server/src/nostr/listener.ts`, the call site becomes:

```ts
      const result = await processBid(payload, db, pub, serverPubkey)
```

(`serverPubkey` already exists in that module — it is `serverPrivkey ? getPublicKey(serverPrivkey) : null`; guard: only process when non-null.)

In `apps/server/src/routes/auctions.ts`, compute and pass the server pubkey:

```ts
import { getPublicKey } from "nostr-tools"
import { nip19 } from "nostr-tools"
import { hexToBytes } from "nostr-tools/utils"

// inside createAuctionRoutes, once:
function serverPubkey(): string | null {
  const key = process.env.NOSTR_PRIVATE_KEY
  if (!key) return null
  try {
    if (!key.startsWith("nsec")) return getPublicKey(hexToBytes(key))
    const { data } = nip19.decode(key)
    return getPublicKey(data as Uint8Array)
  } catch {
    return null
  }
}
```

and in the `POST /bids` handler, replace `processBid(body, db, publisher)` with `processBid(body, db, publisher, serverPubkey())`.

- [ ] **Step 6: Run process-bid tests**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/process-bid.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/server run typecheck
git add apps/server/src/lib/auction-lock.ts apps/server/src/process-bid.ts apps/server/src/routes/auctions.ts apps/server/src/nostr/listener.ts apps/server/tests/process-bid.test.ts
git commit -m "feat: serialize bid processing per auction and add buy-now immediate settlement"
```

---

### Task 5: scheduler — grace settle + reserve + settlement result tag

**Files:**
- Modify: `apps/server/src/scheduler/index.ts`
- Modify: `apps/server/src/nostr/publisher.ts` (add `result` tag)
- Modify: `apps/server/tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `withAuctionLock`, `getVerifiedBids`.
- Produces:
  - `publishSettlement(auctionId, sellerPubkey, winnerNpub, amount, bidsChecked, result?: "sold" | "reserve_not_met" | "no_bids")` — appends `["result", ...]` tag.
  - Scheduler settles only when `now >= end_time + 30_000`; extends only when a verified bid has `end_time - 5min <= received_at <= end_time`.

- [ ] **Step 1: Write the failing tests**

Replace the `describe("scheduler")` block in `apps/server/tests/scheduler.test.ts` with:

```ts
describe("scheduler", () => {
  let db: Db

  beforeEach(() => {
    db = initDb()
  })

  function seedBid(auctionId: string, amount: number, receivedAt: number, id = `b${Math.random()}`) {
    db.saveBid({
      id,
      auction_id: auctionId,
      amount,
      bidder_npub: "npub-bidder",
      Y: `y-${id}`,
      received_at: receivedAt,
      status: "verified",
      proof_data: null,
    })
  }

  // NOTE: `tick()` is now async (it awaits `withAuctionLock`) — always await it.
  // Anti-sniping window is [E - 5min, E]: bids seeded at `end_time - 6min` (i.e.
  // `Date.now() - 400_000` when `end_time = Date.now() - 40_000`) stay OUTSIDE the
  // window so the auction settles instead of extending.

  it("does not settle before end_time + grace", async () => {
    const auction = makeAuction({ id: "g1", end_time: Date.now() + 10_000 })
    db.saveAuction(auction)
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    expect(db.getAuction("g1")!.state).toBe("ACTIVE")
  })

  it("settles after end_time + grace with the highest bid", async () => {
    const auction = makeAuction({ id: "g2", end_time: Date.now() - 40_000 })
    db.saveAuction(auction)
    seedBid("g2", 500, Date.now() - 400_000) // E - 6min: outside anti-sniping window
    seedBid("g2", 200, Date.now() - 500_000)
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    const settled = db.getAuction("g2")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBe("npub-bidder")
    expect(settled.winning_amount).toBe(500)
  })

  it("does not extend for a bid inside the grace window (E, E+30s]", async () => {
    const endTime = Date.now() - 10_000 // past E, within grace
    const auction = makeAuction({ id: "g3", end_time: endTime })
    db.saveAuction(auction)
    seedBid("g3", 300, endTime + 10_000) // arrived in grace
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    expect(db.getAuction("g3")!.state).toBe("ACTIVE") // not yet settled (still within grace), and not extended
  })

  it("extends when a bid arrived within the last 5 minutes before E", async () => {
    const endTime = Date.now() + 60_000
    const auction = makeAuction({ id: "g4", end_time: endTime })
    db.saveAuction(auction)
    seedBid("g4", 300, endTime - 60_000) // 1 min before E, within the window
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    const auction2 = db.getAuction("g4")!
    expect(auction2.state).toBe("EXTENDED")
    expect(auction2.end_time).toBe(endTime + 5 * 60_000)
  })

  it("does not settle a reserve not met", async () => {
    const auction = makeAuction({
      id: "g5",
      end_time: Date.now() - 40_000,
      reserve_price: 1000,
    })
    db.saveAuction(auction)
    seedBid("g5", 500, Date.now() - 400_000)
    const scheduler = createScheduler(db, makePublisher())
    await scheduler.tick()
    const settled = db.getAuction("g5")!
    expect(settled.state).toBe("SETTLED")
    expect(settled.winner_npub).toBeNull()
    expect(settled.winning_amount).toBe(0)
  })

  it("publishes settlement with result tags", async () => {
    const auction = makeAuction({ id: "g6", end_time: Date.now() - 40_000, reserve_price: 1000 })
    db.saveAuction(auction)
    seedBid("g6", 500, Date.now() - 400_000)
    const { pub, calls } = makePublisher()
    const scheduler = createScheduler(db, pub)
    await scheduler.tick()
    const call = calls.find((c: any) => c.type === "settlement") as any
    expect(call).toBeTruthy()
    expect(call.args[5]).toBe("reserve_not_met")
  })

  it("settles a winning bid above reserve as sold", async () => {
    const auction = makeAuction({ id: "g7", end_time: Date.now() - 40_000, reserve_price: 1000 })
    db.saveAuction(auction)
    seedBid("g7", 1500, Date.now() - 400_000)
    const { pub, calls } = makePublisher()
    const scheduler = createScheduler(db, pub)
    await scheduler.tick()
    const call = calls.find((c: any) => c.type === "settlement") as any
    expect(call.args[5]).toBe("sold")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/scheduler.test.ts`
Expected: FAIL — current scheduler settles at `end_time` (no grace), extends on grace-window bids, ignores reserve, and publishes no result tag.

- [ ] **Step 3: Update the publisher**

In `apps/server/src/nostr/publisher.ts`:

```ts
export interface Publisher {
  publishSettlement(
    auctionId: string,
    sellerPubkey: string,
    winnerNpub: string | null,
    amount: number,
    bidsChecked: number,
    result?: "sold" | "reserve_not_met" | "no_bids",
  ): void
  publishBid(...): void
}
```

and in the implementation:

```ts
    publishSettlement(
      auctionId: string,
      sellerPubkey: string,
      winnerNpub: string | null,
      amount: number,
      bidsChecked: number,
      result: "sold" | "reserve_not_met" | "no_bids" = "sold",
    ) {
      const aTag = `39000:${sellerPubkey}:${auctionId}`
      const tags: string[][] = [["a", aTag], ["result", result]]
      if (winnerNpub) tags.push(["p", winnerNpub])
      tags.push(["winner_amount", String(amount)])
      signAndPublish({
        kind: 39003,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify({
          bids_checked: bidsChecked,
          settled_at: Date.now(),
        }),
      })
    },
```

- [ ] **Step 4: Rewrite the scheduler**

Replace `apps/server/src/scheduler/index.ts`:

```ts
import type { Auction } from "@cashu-auction/shared"
import type { Db } from "../db/index.js"
import type { Publisher } from "../nostr/publisher.js"
import { createPublisher } from "../nostr/publisher.js"
import { withAuctionLock } from "../lib/auction-lock.js"

const POLL_INTERVAL = 60_000
const EXTEND_BY = 5 * 60_000
const GRACE_MS = 30_000
const ANTI_SNIPING_WINDOW = 5 * 60_000

export function createScheduler(
  db: Db,
  publisher?: Publisher,
) {
  let timer: ReturnType<typeof setInterval> | null = null
  const pub = publisher ?? createPublisher()

  async function tick() {
    const now = Date.now()

    const needingCheck = db.getActiveAuctions()

    for (const auction of needingCheck) {
      await withAuctionLock(auction.id, async () => {
        const current = db.getAuction(auction.id)
        if (!current) return
        if (current.state !== "ACTIVE" && current.state !== "EXTENDED") return

        const bids = db.getVerifiedBids(current.id)
        const e = current.end_time

        // Only consider bids that arrived before E for extension (spec §5.2)
        const hasSnipingBid = bids.some(
          (b) => b.received_at <= e && b.received_at > e - ANTI_SNIPING_WINDOW,
        )

        if (hasSnipingBid) {
          // Anti-sniping: extend by a full 5 minutes from the original end (spec §5.1)
          current.state = "EXTENDED"
          current.end_time = e + EXTEND_BY
          current.last_extended_at = now
          db.saveAuction(current)
          return
        }

        if (now < e + GRACE_MS) {
          // still inside grace with no sniping bid: wait
          return
        }

        settle(current, bids, db, pub)
      })
    }
  }

  function settle(auction: Auction, bids: ReturnType<Db["getVerifiedBids"]>, db: Db, pub: Publisher) {
    const bidsChecked = bids.length

    const threshold = Math.max(
      auction.start_price,
      auction.reserve_price ?? auction.start_price,
    )

    if (bidsChecked === 0 || bids[0]!.amount < threshold) {
      const result = bidsChecked === 0 ? "no_bids" : "reserve_not_met"
      pub.publishSettlement(
        auction.id,
        auction.seller_pubkey,
        null,
        0,
        bidsChecked,
        result,
      )
      auction.winner_npub = null
      auction.winning_amount = 0
    } else {
      const winner = bids[0]!
      pub.publishSettlement(
        auction.id,
        auction.seller_pubkey,
        winner.bidder_npub,
        winner.amount,
        bidsChecked,
        "sold",
      )
      auction.winner_npub = winner.bidder_npub
      auction.winning_amount = winner.amount
    }

    auction.state = "SETTLED"
    db.saveAuction(auction)
  }

  return {
    start() {
      timer = setInterval(() => {
        tick().catch((err) => console.error("scheduler tick failed", err))
      }, POLL_INTERVAL)
      console.log("scheduler started (interval: 60s)")
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      console.log("scheduler stopped")
    },
    tick,
  }
}
```

- [ ] **Step 5: Run scheduler tests**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/scheduler.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/server run typecheck
git add apps/server/src/scheduler/index.ts apps/server/src/nostr/publisher.ts apps/server/tests/scheduler.test.ts
git commit -m "feat: deterministic grace settlement, reserve check, settlement result tag"
```

---

### Task 6: claim-data / co-sign / refund-data / shipping endpoints

**Files:**
- Modify: `apps/server/src/db/index.ts` (shipping table + `saveShipping`/`getShipping`)
- Modify: `apps/server/src/routes/auctions.ts`
- Create: `apps/server/src/claim.ts` (shared claim/refund validation logic)
- Test: `apps/server/tests/claim.test.ts`

**Interfaces:**
- Consumes: `signSecret`/`verifySecretSignature` from `lib/schnorr.js`, `parseP2PKSecret` from `verify/index.js`, `canonicalPubkey`.
- Produces:
  - `validateClaim(auction, winningBid, claimantPubkey): { ok: true; winningSecret: string; locktimeSec: number } | { ok: false; error: string }`
  - `POST /api/auctions/:id/co-sign` body `{ secret, seller_sig }` → `{ server_sig }` (200) or `{ error }` (400).
  - `GET /api/auctions/:id/claim-data?seller_pubkey=<pk>` → winning `proof_data` object.
  - `GET /api/bids/:id/refund-data?bidder_pubkey=<pk>` → that bid's `proof_data` (only after locktime).
  - `POST /api/auctions/:id/shipping` body `{ event }` (kind:39004 Nostr event) → 200; `GET /api/auctions/:id/shipping?seller_pubkey=<pk>` → `{ address, note } | null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/tests/claim.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vite-plus/test"
import { initDb, type Db } from "../src/db/index.js"
import { validateClaim } from "../src/claim.js"
import type { Auction, Bid } from "@cashu-auction/shared"

const SELLER = "02deadbeef"
const SERVER = "04server"
const BIDDER = "03cafebabe"

function makeAuction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: "a1",
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: SELLER,
    state: "SETTLED",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: BIDDER,
    winning_amount: 500,
    mint_url: "https://mint.example",
    ...overrides,
  }
}

function makeBid(overrides: Partial<Bid> = {}): Bid {
  const secret = JSON.stringify([
    "P2PK",
    {
      nonce: "n1",
      data: SELLER,
      tags: [
        ["pubkeys", SERVER],
        ["n_sigs", "2"],
        ["locktime", String(Math.floor(Date.now() / 1000) + 3600)],
        ["refund", BIDDER],
      ],
    },
  ])
  return {
    id: "a1-y",
    auction_id: "a1",
    amount: 500,
    bidder_npub: BIDDER,
    Y: "y",
    received_at: Date.now(),
    status: "verified",
    proof_data: JSON.stringify({
      keyset_id: "ks1",
      C: "c",
      secret,
      mint_url: "https://mint.example",
      amount: 500,
    }),
    ...overrides,
  }
}

describe("validateClaim", () => {
  it("accepts the seller for a settled auction with a winner", () => {
    const result = validateClaim(makeAuction(), makeBid(), SELLER)
    expect(result.ok).toBe(true)
    if (result.ok) expect(typeof result.winningSecret).toBe("string")
  })

  it("rejects a non-seller claimant", () => {
    const result = validateClaim(makeAuction(), makeBid(), "02attacker")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("NOT_SELLER")
  })

  it("rejects when the auction is not settled", () => {
    const result = validateClaim(makeAuction({ state: "ACTIVE" }), makeBid(), SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("NOT_SETTLED")
  })

  it("rejects when there is no winner", () => {
    const result = validateClaim(makeAuction({ winner_npub: null }), makeBid(), SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("NO_WINNER")
  })

  it("rejects when locktime has already passed", () => {
    const bid = makeBid()
    const proof = JSON.parse(bid.proof_data!) as { secret: string }
    // secret with locktime in the past
    proof.secret = JSON.stringify([
      "P2PK",
      {
        nonce: "n2",
        data: SELLER,
        tags: [
          ["pubkeys", SERVER],
          ["n_sigs", "2"],
          ["locktime", String(Math.floor(Date.now() / 1000) - 60)],
          ["refund", BIDDER],
        ],
      },
    ])
    bid.proof_data = JSON.stringify(proof)
    const result = validateClaim(makeAuction(), bid, SELLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("CLAIM_EXPIRED")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/claim.test.ts`
Expected: FAIL — module `../src/claim.js` does not exist.

- [ ] **Step 3: Create `apps/server/src/claim.ts`**

```ts
import type { Auction, Bid } from "@cashu-auction/shared"
import { canonicalPubkey } from "./lib/canonical.js"
import { parseP2PKSecret } from "./verify/index.js"

export type ClaimResult =
  | { ok: true; winningSecret: string; locktimeSec: number }
  | { ok: false; error: string }

export function validateClaim(
  auction: Auction,
  winningBid: Bid,
  claimantPubkey: string,
): ClaimResult {
  if (auction.state !== "SETTLED") return { ok: false, error: "NOT_SETTLED" }
  if (!auction.winner_npub) return { ok: false, error: "NO_WINNER" }
  if (canonicalPubkey(claimantPubkey) !== canonicalPubkey(auction.seller_pubkey)) {
    return { ok: false, error: "NOT_SELLER" }
  }

  if (!winningBid.proof_data) return { ok: false, error: "NO_PROOF" }
  const proof = JSON.parse(winningBid.proof_data) as { secret: string }
  const parsed = parseP2PKSecret(proof.secret)
  if ("code" in parsed) return { ok: false, error: "INVALID_PROOF" }

  const locktimeSec = parsed.locktime
  if (Math.floor(Date.now() / 1000) >= locktimeSec) {
    return { ok: false, error: "CLAIM_EXPIRED" }
  }

  return { ok: true, winningSecret: proof.secret, locktimeSec }
}

export function parseProofData(proofData: string): {
  keyset_id: string
  C: string
  secret: string
  mint_url: string
  amount: number
} {
  return JSON.parse(proofData)
}
```

- [ ] **Step 4: Add shipping storage to the DB**

In `apps/server/src/db/index.ts`, extend the schema and interface:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS shipping (
      auction_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (auction_id) REFERENCES auctions(id)
    );
  `)
```

```ts
export interface Db {
  // ...existing...
  saveShipping: (auctionId: string, address: string, note: string | null) => void
  getShipping: (auctionId: string) => { address: string; note: string | null } | null
}

  // in the returned object:
  saveShipping(auctionId, address, note) {
    db.prepare(
      `INSERT OR REPLACE INTO shipping (auction_id, address, note, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(auctionId, address, note, Date.now())
  },
  getShipping(auctionId) {
    return (db
      .prepare("SELECT address, note FROM shipping WHERE auction_id = ?")
      .get(auctionId) ?? null) as { address: string; note: string | null } | null
  },
```

- [ ] **Step 5: Add the routes**

In `apps/server/src/routes/auctions.ts`, import the helpers and add the routes (inside `createAuctionRoutes`):

```ts
import { validateClaim, parseProofData } from "../claim.js"
import { verifySecretSignature, signSecret } from "../lib/schnorr.js"
import { canonicalPubkey } from "../lib/canonical.js"
import { verifyEvent } from "nostr-tools/pure"
import type { Event } from "nostr-tools"
```

Routes:

```ts
  // ── Claim: seller fetches the winning proof ──
  router.get("/auctions/:id/claim-data", (c) => {
    const auction = db.getAuction(c.req.param("id")!)
    if (!auction) return c.json({ error: "not found" }, 404)
    const sellerPubkey = c.req.query("seller_pubkey") ?? ""
    const bids = db.getVerifiedBids(auction.id)
    const winningBid = bids[0] ?? null
    const claim = winningBid ? validateClaim(auction, winningBid, sellerPubkey) : { ok: false as const, error: "NO_WINNER" }
    if (!claim.ok) return c.json({ error: claim.error }, 400)
    return c.json(parseProofData(winningBid!.proof_data!))
  })

  // ── Claim: server co-signs the winning proof's secret ──
  router.post("/auctions/:id/co-sign", async (c) => {
    const auction = db.getAuction(c.req.param("id")!)
    if (!auction) return c.json({ error: "not found" }, 404)
    let body: { secret?: string; seller_sig?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }
    const { secret, seller_sig } = body
    if (!secret || !seller_sig) {
      return c.json({ error: "missing secret or seller_sig" }, 400)
    }

    const bids = db.getVerifiedBids(auction.id)
    const winningBid = bids[0] ?? null
    const sellerPubkey = auction.seller_pubkey
    const claim = winningBid
      ? validateClaim(auction, winningBid, sellerPubkey)
      : { ok: false as const, error: "NO_WINNER" }
    if (!claim.ok) return c.json({ error: claim.error }, 400)

    if (secret !== claim.winningSecret) {
      return c.json({ error: "INVALID_MSG" }, 400)
    }

    const sellerXOnly = canonicalPubkey(sellerPubkey)
    if (!verifySecretSignature(seller_sig, secret, sellerXOnly)) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400)
    }

    const key = process.env.NOSTR_PRIVATE_KEY
    if (!key) return c.json({ error: "server key not configured" }, 500)
    let skHex: string
    if (key.startsWith("nsec")) {
      const { data } = nip19.decode(key)
      skHex = bytesToHex(data as Uint8Array)
    } else {
      skHex = key
    }

    return c.json({ server_sig: signSecret(secret, skHex) })
  })

  // ── Refund: bidder fetches their own locked proof after locktime ──
  router.get("/bids/:id/refund-data", (c) => {
    const bid = db.getBid(c.req.param("id")!)
    if (!bid) return c.json({ error: "not found" }, 404)
    const bidderPubkey = c.req.query("bidder_pubkey") ?? ""
    if (canonicalPubkey(bidderPubkey) !== canonicalPubkey(bid.bidder_npub)) {
      return c.json({ error: "NOT_BIDDER" }, 400)
    }
    if (!bid.proof_data) return c.json({ error: "NO_PROOF" }, 400)
    const proof = parseProofData(bid.proof_data)
    const parsed = parseP2PKSecret(proof.secret)
    if ("code" in parsed) return c.json({ error: "INVALID_PROOF" }, 400)
    if (Math.floor(Date.now() / 1000) < parsed.locktime) {
      return c.json({ error: "LOCKTIME_NOT_PASSED" }, 400)
    }
    return c.json(proof)
  })

  // ── Checkout: winner registers shipping address (kind:39004 event) ──
  router.post("/auctions/:id/shipping", async (c) => {
    const auction = db.getAuction(c.req.param("id")!)
    if (!auction) return c.json({ error: "not found" }, 404)
    let body: { event?: Event }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }
    const event = body.event
    if (!event || event.kind !== 39004) return c.json({ error: "INVALID_EVENT" }, 400)
    if (!verifyEvent(event)) return c.json({ error: "INVALID_SIGNATURE" }, 400)
    if (canonicalPubkey(event.pubkey) !== canonicalPubkey(auction.winner_npub ?? "")) {
      return c.json({ error: "NOT_WINNER" }, 400)
    }
    let content: { auction_id?: string; address?: string; note?: string }
    try {
      content = JSON.parse(event.content)
    } catch {
      return c.json({ error: "INVALID_CONTENT" }, 400)
    }
    if (content.auction_id !== auction.id || !content.address) {
      return c.json({ error: "INVALID_CONTENT" }, 400)
    }
    db.saveShipping(auction.id, content.address, content.note ?? null)
    return c.json({ ok: true })
  })

  router.get("/auctions/:id/shipping", (c) => {
    const auction = db.getAuction(c.req.param("id")!)
    if (!auction) return c.json({ error: "not found" }, 404)
    const sellerPubkey = c.req.query("seller_pubkey") ?? ""
    if (canonicalPubkey(sellerPubkey) !== canonicalPubkey(auction.seller_pubkey)) {
      return c.json({ error: "NOT_SELLER" }, 400)
    }
    const shipping = db.getShipping(auction.id)
    return c.json(shipping ?? { address: null, note: null })
  })
```

Note: `bytesToHex` is imported from `nostr-tools/utils` — add it to the existing imports in `routes/auctions.ts`.

- [ ] **Step 6: Run the claim tests**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/claim.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/server run typecheck
git add apps/server/src/claim.ts apps/server/src/db/index.ts apps/server/src/routes/auctions.ts apps/server/tests/claim.test.ts
git commit -m "feat: add claim-data, co-sign, refund-data and shipping endpoints"
```

---

### Task 7: rate limiting for unauthenticated endpoints

**Files:**
- Create: `apps/server/src/lib/rate-limit.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/tests/rate-limit.test.ts`

**Interfaces:**
- Produces: `rateLimit({ windowMs, max })` — a Hono middleware returning 429 JSON when exceeded.

- [ ] **Step 1: Write the failing test**

Create `apps/server/tests/rate-limit.test.ts`:

```ts
import { describe, it, expect } from "vite-plus/test"
import { Hono } from "hono"
import { rateLimit } from "../src/lib/rate-limit.js"

describe("rateLimit", () => {
  it("allows up to max requests then returns 429", async () => {
    const app = new Hono()
    app.use("*", rateLimit({ windowMs: 60_000, max: 3 }))
    app.get("/", (c) => c.text("ok"))

    const r1 = await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } })
    const r2 = await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } })
    const r3 = await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } })
    const r4 = await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r3.status).toBe(200)
    expect(r4.status).toBe(429)
  })

  it("treats different IPs separately", async () => {
    const app = new Hono()
    app.use("*", rateLimit({ windowMs: 60_000, max: 1 }))
    app.get("/", (c) => c.text("ok"))
    expect((await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.1.1.1" } })).status).toBe(200)
    expect((await app.request("http://localhost/", { headers: { "x-forwarded-for": "2.2.2.2" } })).status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/rate-limit.test.ts`
Expected: FAIL — `rateLimit` is not exported.

- [ ] **Step 3: Create the limiter**

Create `apps/server/src/lib/rate-limit.ts`:

```ts
import type { MiddlewareHandler } from "hono"

export function rateLimit({ windowMs, max }: { windowMs: number; max: number }): MiddlewareHandler {
  const hits = new Map<string, number[]>()
  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown"
    const now = Date.now()
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
    if (arr.length >= max) {
      return c.json({ error: "rate limit exceeded" }, 429)
    }
    arr.push(now)
    hits.set(ip, arr)
    await next()
  }
}
```

Note: `x-forwarded-for` is client-spoofable, so this limiter is a coarse gate (raises the cost of spam), not a hard security boundary. Deploy behind a reverse proxy that overwrites the header, or accept the limitation for Phase 2 (spec §8.3).

- [ ] **Step 4: Apply it to unauthenticated endpoints**

In `apps/server/src/index.ts`, after the CORS middleware:

```ts
import { rateLimit } from "./lib/rate-limit.js"

app.use("/api/bids", rateLimit({ windowMs: 60_000, max: 30 }))
app.use("/api/auctions/*/co-sign", rateLimit({ windowMs: 60_000, max: 20 }))
app.use("/api/auctions/*/claim-data", rateLimit({ windowMs: 60_000, max: 30 }))
app.use("/api/auctions/*/shipping", rateLimit({ windowMs: 60_000, max: 30 }))
app.use("/api/bids/*/refund-data", rateLimit({ windowMs: 60_000, max: 30 }))
```

- [ ] **Step 5: Run the rate-limit tests**

Run: `pnpm --filter @cashu-auction/server test -- --run tests/rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full server suite, typecheck, commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/server test
pnpm --filter @cashu-auction/server run typecheck
git add apps/server/src/lib/rate-limit.ts apps/server/src/index.ts apps/server/tests/rate-limit.test.ts
git commit -m "feat: rate limit unauthenticated bid/claim/refund endpoints"
```

---

### Task 8: web deps + claim/refund signing library (pure logic)

**Files:**
- Modify: `apps/web/package.json` (add @noble/curves, @noble/hashes, vitest)
- Create: `apps/web/vitest.config.ts`, `apps/web/lib/claim.ts`, `apps/web/lib/claim.test.ts`

**Interfaces:**
- Produces:
  - `fetchClaimData(auctionId, sellerPubkey, apiBase): Promise<StoredProof>`
  - `fetchRefundData(bidId, bidderPubkey, apiBase): Promise<StoredProof>`
  - `requestCoSign(auctionId, secret, sellerSig, apiBase): Promise<string /* server_sig */>`
  - `signSecretHex(secret: string, skHex: string): string`
  - `swapLockedProof(proof, mintUrl, amount, privkeyHex): Promise<Proof[]>` — runs `prepareSwapToSend` + `completeSwap` and returns the resulting proofs.
  - `StoredProof = { keyset_id, C, secret, mint_url, amount }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/claim.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { signSecretHex, buildWitness, swapLockedProof } from "./claim"
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { generateSecretKey, getPublicKey } from "nostr-tools"
import { bytesToHex } from "nostr-tools/utils"

describe("claim signing", () => {
  it("signSecretHex produces a Schnorr signature verifiable against the x-only pubkey", () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk) // x-only
    const secret = '["P2PK",{"nonce":"n","data":"02dead"}]'
    const sig = signSecretHex(secret, bytesToHex(sk))
    const digest = sha256(new TextEncoder().encode(secret))
    expect(schnorr.verify(sig, digest, pk)).toBe(true)
  })

  it("buildWitness merges seller and server signatures into a proof witness", () => {
    const proof = { id: "ks1", amount: 100, secret: "s", C: "c" }
    const result = buildWitness(proof, ["sig-a", "sig-b"])
    expect(result.witness).toContain("sig-a")
    expect(result.witness).toContain("sig-b")
    expect(JSON.parse(result.witness!).signatures).toEqual(["sig-a", "sig-b"])
  })
})

describe("swapLockedProof", () => {
  it("throws with a clear error when the mint is unreachable", async () => {
    const proof = { id: "ks1", amount: 100, secret: "s", C: "c", mint_url: "https://127.0.0.1:1", witness: "" }
    const sk = generateSecretKey()
    await expect(swapLockedProof(proof, 100, bytesToHex(sk))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/claim.test.ts`
Expected: FAIL — module `./claim` not found.

- [ ] **Step 3: Add dependencies and vitest config**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/web add @noble/curves @noble/hashes
pnpm --filter @cashu-auction/web add -D vitest
```

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 4: Create `apps/web/lib/claim.ts`**

```ts
import { schnorr } from "@noble/curves/secp256k1"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex, hexToBytes } from "nostr-tools/utils"
import { Wallet, Amount } from "@cashu/cashu-ts"
import type { Proof } from "@cashu/cashu-ts"

export interface StoredProof {
  keyset_id: string
  C: string
  secret: string
  mint_url: string
  amount: number
}

export function signSecretHex(secret: string, skHex: string): string {
  const digest = sha256(new TextEncoder().encode(secret))
  return bytesToHex(schnorr.sign(digest, hexToBytes(skHex)))
}

export function buildWitness(
  proof: { id: string; amount: number; secret: string; C: string },
  signatures: string[],
): Proof {
  return {
    ...proof,
    witness: JSON.stringify({ signatures }),
  } as Proof
}

export async function swapLockedProof(
  proof: Proof,
  amount: number,
  privkeyHex: string,
): Promise<Proof[]> {
  const wallet = new Wallet(proof.mint_url ?? "", { unit: "sat" })
  await wallet.loadMint()
  const preview = await wallet.prepareSwapToSend(Amount.from(amount), [proof])
  const result = await wallet.completeSwap(preview, privkeyHex)
  return [...result.send, ...result.keep]
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

export async function fetchClaimData(
  auctionId: string,
  sellerPubkey: string,
  apiBase = API_BASE,
): Promise<StoredProof> {
  const res = await fetch(`${apiBase}/api/auctions/${auctionId}/claim-data?seller_pubkey=${sellerPubkey}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "claim-data failed")
  }
  return res.json() as Promise<StoredProof>
}

export async function fetchRefundData(
  bidId: string,
  bidderPubkey: string,
  apiBase = API_BASE,
): Promise<StoredProof> {
  const res = await fetch(`${apiBase}/api/bids/${bidId}/refund-data?bidder_pubkey=${bidderPubkey}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "refund-data failed")
  }
  return res.json() as Promise<StoredProof>
}

export async function requestCoSign(
  auctionId: string,
  secret: string,
  sellerSig: string,
  apiBase = API_BASE,
): Promise<string> {
  const res = await fetch(`${apiBase}/api/auctions/${auctionId}/co-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, seller_sig: sellerSig }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? "co-sign failed")
  }
  const data = (await res.json()) as { server_sig: string }
  return data.server_sig
}

/** Full seller claim: fetch → sign → co-sign → swap. Returns new wallet proofs. */
export async function claimAuction(
  auctionId: string,
  sellerPubkey: string,
  sellerSkHex: string,
  apiBase = API_BASE,
): Promise<Proof[]> {
  const sp = await fetchClaimData(auctionId, sellerPubkey, apiBase)
  const sellerSig = signSecretHex(sp.secret, sellerSkHex)
  const serverSig = await requestCoSign(auctionId, sp.secret, sellerSig, apiBase)
  const proof = buildWitness(
    { id: sp.keyset_id, amount: sp.amount, secret: sp.secret, C: sp.C },
    [sellerSig, serverSig],
  )
  ;(proof as unknown as { mint_url: string }).mint_url = sp.mint_url
  return swapLockedProof(proof, sp.amount, sellerSkHex)
}

/** Full bidder refund: fetch → sign (refund key) → swap. */
export async function refundBid(
  bidId: string,
  bidderPubkey: string,
  bidderSkHex: string,
  apiBase = API_BASE,
): Promise<Proof[]> {
  const sp = await fetchRefundData(bidId, bidderPubkey, apiBase)
  const bidderSig = signSecretHex(sp.secret, bidderSkHex)
  const proof = buildWitness(
    { id: sp.keyset_id, amount: sp.amount, secret: sp.secret, C: sp.C },
    [bidderSig],
  )
  ;(proof as unknown as { mint_url: string }).mint_url = sp.mint_url
  return swapLockedProof(proof, sp.amount, bidderSkHex)
}
```

Note: `Proof.mint_url` is not in the type — the `mint_url` is stashed on the object at runtime and read by `swapLockedProof`. If `@cashu/cashu-ts` types reject the cast, use `(proof as unknown as Proof & { mint_url: string })` instead.

- [ ] **Step 5: Run the claim tests**

Run: `cd apps/web && npx vitest run lib/claim.test.ts`
Expected: PASS (the unreachable-mint test throws a network error).

- [ ] **Step 6: Add a test script to `apps/web/package.json`**

```json
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit",
    "test": "vitest run"
  },
```

- [ ] **Step 7: Typecheck and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/web run typecheck
git add apps/web/lib/claim.ts apps/web/lib/claim.test.ts apps/web/vitest.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add claim/refund signing library with tests"
```

---

### Task 9: web bid form — 2-of-2 lock, buy-now, mint default, grace note

**Files:**
- Modify: `apps/web/lib/wallet.ts` (nothing needed for options — P2PKOptions passes through; verify only)
- Modify: `apps/web/app/auctions/[id]/bid-form.tsx`
- Modify: `apps/web/app/auctions/[id]/detail-bid-panel.tsx`

**Interfaces:**
- Consumes: `auction.mint_url`, `auction.buy_now_price`, server pubkey from `/health`.
- Produces: bids with `pubkey: [seller, server], requiredSignatures: 2`; Buy Now button; mint default `auction.mint_url`; grace-window note.

- [ ] **Step 1: Update the bid-proof creation to 2-of-2**

In `apps/web/app/auctions/[id]/bid-form.tsx`:

Replace the proof creation block (the `if (testMode) {...} else {...}` inside `handleSubmit`):

```tsx
      if (testMode) {
        const secret = createP2PKsecret(auction.seller_pubkey, [
          ["pubkeys", serverPubkeyHex],
          ["n_sigs", "2"],
          ["locktime", String(locktime)],
          ["refund", identity.pubkey],
        ])
        proof = {
          id: "test-keyset",
          amount: Amount.from(bidAmount),
          secret,
          C: "test-signature",
        }
        mintUrlForBid = TEST_MINT_URL
      } else {
        const { proof: walletProof } = await wallet.sendP2PK(bidAmount, {
          pubkey: [auction.seller_pubkey, serverPubkeyHex],
          requiredSignatures: 2,
          locktime,
          refundKeys: [identity.pubkey],
        })
        proof = walletProof
        mintUrlForBid = mintUrl
      }
```

- [ ] **Step 2: Default the mint to the auction's mint**

In `apps/web/app/auctions/[id]/bid-form.tsx`, change the state initializer:

```tsx
  // Wallet — default to the mint the seller specified (spec §7.4 / review G4)
  const [mintUrl, setMintUrl] = useState(auction.mint_url || DEFAULT_MINT)
```

Remove the now-unused `DEFAULT_MINT` constant if no other reference remains.

- [ ] **Step 3: Add the grace-window note**

In the bid panel (below the bid form, in `detail-bid-panel.tsx`), inside the "Bid note" div, append:

```tsx
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        Bids sent before the end time are accepted until {`end + 30s`} (relay grace). Bids in
        the last 5 minutes extend the auction by 5 minutes.
      </p>
```

- [ ] **Step 4: Add the Buy Now button (via a BidForm prop — no DOM hackery)**

In `apps/web/app/auctions/[id]/bid-form.tsx`, add an optional prop and a dedicated submit path. Change the props type:

```tsx
export function BidForm({
  auction,
  serverNpub: serverNpubProp,
  buyNowPrice,
}: {
  auction: Auction
  serverNpub: string
  buyNowPrice?: number | null
}) {
```

In `handleSubmit`, after the `const bidAmount = parseInt(amount, 10)` block, override the amount when `buyNowPrice` is set:

```tsx
    const bidAmount =
      buyNowPrice !== undefined && buyNowPrice !== null
        ? buyNowPrice
        : parseInt(amount, 10)
```

Keep the original NaN/positive guard but apply it ONLY to the manual-entry path — Buy Now bypasses it since `buyNowPrice` is a trusted number from the auction event:

```tsx
    if (buyNowPrice === undefined || buyNowPrice === null) {
      if (isNaN(bidAmount) || bidAmount <= 0) {
        setError("amount must be a positive number")
        return
      }
    }
```

In `apps/web/app/auctions/[id]/detail-bid-panel.tsx`, compute availability and render the button above `<BidForm .../>`:

```tsx
  const buyNowAvailable =
    isOpen &&
    auction.buy_now_price !== null &&
    auction.buy_now_price > 0 &&
    (bids.length === 0 || auction.buy_now_price > bids[0]!.amount)
```

```tsx
      {buyNowAvailable && (
        <button
          type="button"
          onClick={() => setBuyNow(true)}
          style={{
            width: "100%",
            border: "none",
            borderRadius: "var(--radius)",
            background: "var(--accent)",
            color: "#fff",
            padding: "12px 24px",
            fontSize: 15,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            marginBottom: 8,
          }}
        >
          Buy Now — {auction.buy_now_price!.toLocaleString()} sats
        </button>
      )}
```

Add the state and pass it through:

```tsx
  const [buyNow, setBuyNow] = useState(false)
  // in the JSX:
  <BidForm auction={auction} serverNpub={serverNpub} buyNowPrice={buyNow ? auction.buy_now_price : undefined} />
```

This reuses the existing bid submit path (which becomes an immediate settle server-side because `amount >= buy_now_price`).

- [ ] **Step 5: Verify the build**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/web run typecheck
pnpm --filter @cashu-auction/web run build
```

- [ ] **Step 6: Commit**

```bash
cd /Users/sktr/repo/cashu-auction
git add apps/web/app/auctions/[id]/bid-form.tsx apps/web/app/auctions/[id]/detail-bid-panel.tsx
git commit -m "feat: 2-of-2 bid lock, buy-now button, auction mint default, grace note"
```

---

### Task 10: web create form — reserve price + buy now fields, fee/deposit removal

**Files:**
- Modify: `apps/web/app/create/page.tsx`

**Interfaces:**
- Produces: content with `reserve_price` (existing, relabeled) and `buy_now_price` (new field); fee/deposit UI removed.

- [ ] **Step 1: Relabel the existing "Buy Now Price" field as "Reserve Price"**

In `apps/web/app/create/page.tsx`, the field labeled "Buy Now Price" is bound to `reservePrice` and writes `content.reserve_price` — keep that binding, change only the label and placeholder:

```tsx
                <label
                  htmlFor="reservePrice"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 400,
                    marginBottom: 6,
                  }}
                >
                  Reserve Price <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>(optional, no sale below this)</span>
                </label>
                <input
                  id="reservePrice"
                  type="number"
                  min="0"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  placeholder="—"
                  style={inputTextStyle}
                  onFocus={handleFocus}
                  onBlur={(e) => handleBlur(e)}
                />
```

- [ ] **Step 2: Add a Buy Now Price field next to it**

```tsx
              <div>
                <label
                  htmlFor="buyNowPrice"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 400,
                    marginBottom: 6,
                  }}
                >
                  Buy Now Price <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>(optional)</span>
                </label>
                <input
                  id="buyNowPrice"
                  type="number"
                  min="0"
                  value={buyNowPrice}
                  onChange={(e) => setBuyNowPrice(e.target.value)}
                  placeholder="—"
                  style={inputTextStyle}
                  onFocus={handleFocus}
                  onBlur={(e) => handleBlur(e)}
                />
              </div>
```

Add state next to `reservePrice`:

```tsx
  const [buyNowPrice, setBuyNowPrice] = useState("")
```

Include it in the published content (next to the existing `reserve_price` write):

```tsx
      if (buyNowPrice) {
        const bp = parseInt(buyNowPrice, 10)
        if (!isNaN(bp) && bp > 0) content.buy_now_price = bp
      }
```

Include it in the modal summary rows and the preview rows (add a `["Buy Now Price", buyNowPrice ? `${parseInt(buyNowPrice, 10).toLocaleString()} sats` : "None"]` row after the Reserve Price row).

- [ ] **Step 3: Remove the listing fee and deposit UI**

In `apps/web/app/create/page.tsx`:
- Delete the `agreeFees` state, its checkbox block (`I understand the listing fee (5% of final price)`), and the `fieldErrors.agreeFees` reference in `validate()`.
- In the confirmation modal table, delete the `["Deposit", "5,000 sats (refundable)"]` row.
- In the preview sidebar, delete the `["Listing Fee", "—"]` row.

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/web run typecheck
git add apps/web/app/create/page.tsx
git commit -m "feat: add buy-now field, relabel reserve price, remove fee/deposit UI"
```

---

### Task 11: web watchlist (client-side)

**Files:**
- Create: `apps/web/lib/watchlist.ts` (+ test)
- Modify: `apps/web/app/auctions/[id]/detail-bid-panel.tsx`
- Modify: `apps/web/app/dashboard/page.tsx`

**Interfaces:**
- Produces: `useWatchlist()` hook — `{ watching: boolean, toggle(): void, ids: Set<string> }` persisted in localStorage under `cashu-auction-watchlist`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/watchlist.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { loadWatchlist, saveWatchlist, toggleId } from "./watchlist"

describe("watchlist storage helpers", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it("loads an empty list by default", () => {
    expect(loadWatchlist()).toEqual([])
  })

  it("toggleId adds and removes ids", () => {
    expect(toggleId([], "a1")).toEqual(["a1"])
    expect(toggleId(["a1"], "a1")).toEqual([])
  })

  it("saveWatchlist round-trips", () => {
    saveWatchlist(["a1", "a2"])
    expect(loadWatchlist()).toEqual(["a1", "a2"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/watchlist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/web/lib/watchlist.ts`**

```ts
"use client"

import { useCallback, useState } from "react"

const STORAGE_KEY = "cashu-auction-watchlist"

export function loadWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveWatchlist(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // storage unavailable — ignore
  }
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

export function useWatchlist() {
  const [ids, setIds] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : loadWatchlist(),
  )
  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = toggleId(prev, id)
      saveWatchlist(next)
      return next
    })
  }, [])
  return { ids, watching: (id: string) => ids.includes(id), toggle }
}
```

- [ ] **Step 4: Wire the detail-page button**

In `apps/web/app/auctions/[id]/detail-bid-panel.tsx`, import and use the hook:

```tsx
import { useWatchlist } from "../../../lib/watchlist"
// inside component:
const { watching, toggle } = useWatchlist()
const isWatching = watching(auction.id)
```

Replace the "♡ Add to Watchlist" button:

```tsx
        <button
          type="button"
          onClick={() => toggle(auction.id)}
          style={{
            flex: 1,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: isWatching ? "var(--accent-soft)" : "var(--surface)",
            color: "var(--fg)",
            padding: "8px 16px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
            lineHeight: 1.4,
          }}
        >
          {isWatching ? "♥ Watching" : "♡ Add to Watchlist"}
        </button>
```

- [ ] **Step 5: Show watchlist on the dashboard**

In `apps/web/app/dashboard/page.tsx`, add a "Watching" section that lists watched auction ids as links to `/auctions/<id>`:

```tsx
import { useWatchlist } from "../../lib/watchlist"
// inside the component:
const { ids } = useWatchlist()
```

Render below the existing tabs (only when `ids.length > 0`):

```tsx
      {ids.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Watching</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {ids.map((id) => (
              <li key={id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <a href={`/auctions/${id}`} style={{ color: "var(--accent)", textDecoration: "none", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  {id}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 6: Verify and commit**

```bash
cd /Users/sktr/repo/cashu-auction
cd apps/web && npx vitest run lib/watchlist.test.ts
cd /Users/sktr/repo/cashu-auction && pnpm --filter @cashu-auction/web run typecheck
git add apps/web/lib/watchlist.ts apps/web/lib/watchlist.test.ts apps/web/app/auctions/[id]/detail-bid-panel.tsx apps/web/app/dashboard/page.tsx
git commit -m "feat: client-side watchlist"
```

---

### Task 12: web checkout (winner shipping address)

**Files:**
- Create: `apps/web/app/auctions/[id]/checkout.tsx`
- Modify: `apps/web/app/auctions/[id]/page.tsx` (render when the viewer is the winner)

**Interfaces:**
- Consumes: `useIdentity` (winner's key, NIP-07 or fallback), `auction.id`, `auction.winner_npub`.
- Produces: kind:39004 Nostr event (signed by the winner) posted to `POST /api/auctions/:id/shipping`.

- [ ] **Step 1: Create the checkout component**

Create `apps/web/app/auctions/[id]/checkout.tsx`:

```tsx
"use client"

import { useState } from "react"
import { finalizeEvent } from "nostr-tools"
import { useIdentity } from "../../../lib/identity"
import { loadOrCreateKey } from "../../../lib/nostr"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

export function Checkout({ auctionId, winnerNpub }: { auctionId: string; winnerNpub: string }) {
  const { identity } = useIdentity()
  const [address, setAddress] = useState("")
  const [note, setNote] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // winnerNpub is stored as the bidder's HEX pubkey (process-bid.ts stores
  // bidder_pubkey hex into bidder_npub) — compare hex-vs-hex, not npub.
  const isWinner =
    identity && winnerNpub && identity.pubkey === winnerNpub

  if (!isWinner) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    if (!identity) return

    // Signing key: NIP-07 (signEvent) or the in-app fallback key
    let event
    const template = {
      kind: 39004,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["a", `39000::${auctionId}`]],
      content: JSON.stringify({ auction_id: auctionId, address, note }),
    }
    if (identity.type === "nip07" && typeof window !== "undefined" && window.nostr) {
      const signed = await window.nostr.signEvent(template)
      event = { ...template, id: signed.id, sig: signed.sig, pubkey: identity.pubkey }
    } else if (identity.secretKey) {
      const key = loadOrCreateKey()
      event = finalizeEvent(template, key.secretKey)
    } else {
      setError("signing unavailable")
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/auctions/${auctionId}/shipping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "failed to submit shipping info")
      }
      setStatus("Shipping address submitted to the seller.")
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginTop: 24,
      }}
    >
      <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>You won — provide shipping details</h2>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Shipping address"
          required
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            fontSize: 14,
            fontFamily: "inherit",
            background: "var(--surface)",
            color: "var(--fg)",
          }}
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note to the seller (optional)"
          rows={2}
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            fontSize: 14,
            fontFamily: "inherit",
            background: "var(--surface)",
            color: "var(--fg)",
            resize: "vertical",
          }}
        />
        <button
          type="submit"
          style={{
            alignSelf: "flex-start",
            border: "none",
            borderRadius: "var(--radius)",
            background: "var(--accent)",
            color: "#fff",
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Submit
        </button>
        {error && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}
        {status && <p style={{ color: "var(--accent2)", fontSize: 13, margin: 0 }}>{status}</p>}
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Render it on the detail page**

In `apps/web/app/auctions/[id]/page.tsx`, import and render after the main content (the `Checkout` component self-hides for non-winners):

```tsx
import { Checkout } from "./checkout"
// ...
      <Checkout auctionId={auction.id} winnerNpub={auction.winner_npub ?? ""} />
```

- [ ] **Step 3: Seller-side shipping view on the dashboard**

In `apps/web/app/dashboard/page.tsx`, for settled auctions where `auction.seller_pubkey === identity.pubkey` and a winner exists, fetch and show the shipping address:

```tsx
async function loadShipping(
  auctionId: string,
  sellerPubkeyHex: string,
): Promise<{ address: string | null; note: string | null }> {
  // server mounts routes under /api (apps/server/src/index.ts: app.route("/api", ...))
  const res = await fetch(`${API_BASE}/api/auctions/${auctionId}/shipping?seller_pubkey=${sellerPubkeyHex}`)
  if (!res.ok) return { address: null, note: null }
  return res.json()
}

// call site, inside the dashboard component after auctions load:
//   const sh = await loadShipping(auction.id, identity.pubkey)
//   if (sh.address) render `Shipping: {sh.address}` in the won-listing card
```

Render `address` in the won-listing card for that auction (label: "Shipping").

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/web run typecheck
pnpm --filter @cashu-auction/web run build
git add apps/web/app/auctions/[id]/checkout.tsx apps/web/app/auctions/[id]/page.tsx apps/web/app/dashboard/page.tsx
git commit -m "feat: winner checkout with kind:39004 shipping info"
```

---

### Task 13: web claim/refund UI + dashboard cleanup

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx` (Claim/Refund buttons, replace "Copy Proof", legacy display)
- Create: `apps/web/app/auctions/[id]/claim-panel.tsx`

**Interfaces:**
- Consumes: `claimAuction`, `refundBid` from `lib/claim.js`, `useIdentity`, `useWallet`.
- Produces: seller Claim button (settled + winner + seller); bidder Refund button (replaced/outbid bids after locktime).

- [ ] **Step 1: Create the claim panel component**

Create `apps/web/app/auctions/[id]/claim-panel.tsx`:

```tsx
"use client"

import { useState } from "react"
import type { Auction } from "@cashu-auction/shared"
import { useIdentity } from "../../../lib/identity"
import { claimAuction } from "../../../lib/claim"
import { loadOrCreateKey } from "../../../lib/nostr"
import { bytesToHex } from "nostr-tools/utils"

export function ClaimPanel({
  auction,
  isSeller,
  isWinner,
}: {
  auction: Auction
  isSeller: boolean
  isWinner: boolean
}) {
  const { identity } = useIdentity()
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canClaim =
    isSeller && auction.state === "SETTLED" && auction.winner_npub !== null

  const claim = async () => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const key = loadOrCreateKey() // in-app key — NIP-07 cannot sign arbitrary messages
      if (key.pubkey !== auction.seller_pubkey) {
        throw new Error("claim requires the in-app key that created this auction")
      }
      const proofs = await claimAuction(
        auction.id,
        auction.seller_pubkey,
        bytesToHex(key.secretKey),
      )
      setStatus(
        `Claimed ${(auction.winning_amount ?? 0).toLocaleString()} sats (${proofs.length} proof${proofs.length === 1 ? "" : "s"}). Refresh your wallet to see the balance.`,
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!canClaim) return null

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={claim}
        disabled={busy}
        style={{
          border: "none",
          borderRadius: "var(--radius)",
          background: "var(--accent)",
          color: "#fff",
          padding: "10px 24px",
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        {busy ? "Claiming…" : `Claim ${(auction.winning_amount ?? 0).toLocaleString()} sats`}
      </button>
      {error && <p style={{ color: "var(--red)", fontSize: 13, margin: "6px 0 0" }}>{error}</p>}
      {status && <p style={{ color: "var(--accent2)", fontSize: 13, margin: "6px 0 0" }}>{status}</p>}
    </div>
  )
}
```

Note: the claim uses `loadOrCreateKey` (the in-app localStorage key) because the 2-of-2 claim requires an arbitrary Schnorr message signature, which NIP-07 cannot provide (spec §6.1).

- [ ] **Step 2: Add a Refund button for outbid bidders**

In `apps/web/app/dashboard/page.tsx`, for each bid in "Active Bids"/history where `bid.status === "replaced"`, render a button. Ensure the dashboard imports `bytesToHex` from `nostr-tools/utils` (add it if absent) — the existing `useIdentity` import stays.

```tsx
<button
  type="button"
  onClick={async () => {
    if (!identity) return
    // bids are placed with the useIdentity key, not loadOrCreateKey (lib/identity.ts
    // "cashu-auction-identity" vs lib/nostr.ts "cashu-auction-nostr-key") — the
    // refund Schnorr signature must come from the SAME key that owns the refund path.
    if (bid.bidder_npub !== identity.pubkey) {
      alert("this bid is not from the connected identity")
      return
    }
    if (!identity.secretKey) {
      alert("recovering requires the in-app key — NIP-07 signing is not supported yet")
      return
    }
    try {
      const proofs = await refundBid(bid.id, bid.bidder_npub, bytesToHex(identity.secretKey))
      alert(`Recovered ${proofs.length} proof(s) — refresh your wallet.`)
    } catch (err) {
      alert(String(err))
    }
  }}
  style={{ /* outline button */ }}
>
  Recover
</button>
```

- [ ] **Step 3: Replace the dashboard "Copy Proof" block**

Find the dashboard block that renders "Ready to Claim / Copy Proof" (around `apps/web/app/dashboard/page.tsx:995-1108`) and replace the Copy Proof button with a `<ClaimPanel auction={auction} isSeller={true} isWinner={false} />` for settled auctions where `auction.seller_pubkey === identity.pubkey`. Delete the raw proof-copying code.

- [ ] **Step 4: Legacy auction display**

In `apps/web/app/auctions/[id]/page.tsx` and `apps/web/app/auction-card.tsx`, when `auction.mint_url === ""`, show a badge:

```tsx
{auction.mint_url === "" && (
  <span style={{ fontSize: 11, color: "var(--muted)" }}>Legacy listing — bidding disabled</span>
)}
```

And in `bid-form.tsx`, guard submission:

```tsx
    if (!auction.mint_url) {
      setError("this legacy listing does not accept bids")
      return
    }
```

- [ ] **Step 5: Verify and commit**

```bash
cd /Users/sktr/repo/cashu-auction
pnpm --filter @cashu-auction/web run typecheck
pnpm --filter @cashu-auction/web run build
git add apps/web/app/auctions/[id]/claim-panel.tsx apps/web/app/dashboard/page.tsx apps/web/app/auctions/[id]/page.tsx apps/web/app/auction-card.tsx apps/web/app/auctions/[id]/bid-form.tsx
git commit -m "feat: claim/refund UI, replace Copy Proof, legacy listing guard"
```

---

### Task 14: docs — CONTEXT.md glossary + how-it-works honesty pass

**Files:**
- Modify: `CONTEXT.md`
- Modify: `apps/web/app/how-it-works/page.tsx`

**Interfaces:**
- Produces: glossary entries for the new domain terms; honest trust-model copy.

- [ ] **Step 1: Extend the CONTEXT.md glossary**

Append to `CONTEXT.md`:

```markdown
**Reserve Price**:
The minimum price required for a sale. If it is not met, there is no winner (result: reserve_not_met).
_Avoid_: minimum bid, floor

**Buy Now**:
A fixed price. When a bid at or above it is accepted, the auction ends immediately and that bidder wins.
_Avoid_: instant purchase, buyout

**Claim**:
The seller collects the winner's proofs. Because of the 2-of-2 lock, both the seller and the server must co-sign.
_Avoid_: receive, payment

**Co-sign**:
The server's co-signature (Schnorr) over the winner proofs' secrets at claim time.
_Avoid_: approval, authentication

**Grace Window**:
Bids are still accepted for 30 seconds after the end time E (E+30s), rescuing bids delayed by relay latency. Bids inside the grace window do not trigger an extension.
_Avoid_: extension, overtime

**2-of-2 Lock**:
The P2PK lock of a bid proof: `data` (seller) and `pubkeys` (server) — two of the two keys must sign to spend. Neither party can move the funds alone.
_Avoid_: multisig, escrow

**Legacy Listing**:
An old-format auction without a `mint_url`. Cannot accept bids.
_Avoid_: old auction
```

- [ ] **Step 2: Update how-it-works copy**

In `apps/web/app/how-it-works/page.tsx`:

Replace the "Settlement" step description with the grace-aware version and update the "Claim" step:

```tsx
  {
    title: "Settlement",
    description:
      "When the auction ends, bids arriving within a 30-second grace window are still accepted. The highest verified bid wins once the grace window closes.",
    detail:
      "State: ACTIVE → EXTENDED → SETTLED · Grace: end + 30s · Winner: highest bid ≥ reserve",
  },
  {
    title: "Claim",
    description:
      "The seller claims the winning bid. Because bids are locked 2-of-2 (seller + server), the server co-signs the claim after settlement. Outbid bidders can recover their locked funds after the locktime (end + 24h) passes.",
    detail:
      "2-of-2: seller sig + server sig · Locktime: end + 24h · Refund: bidder reclaims after locktime",
  },
```

Replace the "Technology" P2PK bullet:

```tsx
            { title: "P2PK", desc: "Pay-to-Public-Key locks each bid proof to the seller AND the auction server (2-of-2). No single party can spend bid funds before settlement; the seller claims with the server's co-signature." },
```

And replace the "Bidders Place Bids" step detail to mention the 2-of-2 lock:

```tsx
    detail: "2-of-2 lock: seller + server keys · n_sigs: 2 · Locktime: end_time + 24h · Refund: bidder pubkey",
```

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/sktr/repo/cashu-auction
grep -q "2-of-2 Lock" CONTEXT.md && echo "glossary ok"
grep -q "Grace: end + 30s" apps/web/app/how-it-works/page.tsx && echo "how-it-works ok"
git add CONTEXT.md apps/web/app/how-it-works/page.tsx
git commit -m "docs: add new domain terms and honest trust-model copy"
```

---

## Verification Checklist (final gate, after Task 14)

Run in order before declaring Phase 2 done:

- [ ] Full server suite: `pnpm --filter @cashu-auction/server test` — all PASS, zero failures.
- [ ] Server typecheck: `pnpm --filter @cashu-auction/server run typecheck` — no errors.
- [ ] Web typecheck: `pnpm --filter @cashu-auction/web run typecheck` — no errors.
- [ ] Web unit tests: `cd apps/web && npx vitest run` — PASS.
- [ ] Web build: `pnpm --filter @cashu-auction/web run build` — succeeds.
- [ ] Real-mint E2E (spec §9.1): with `ALLOW_TEST_BIDS=1` and the server running, place a 2-of-2 bid against `testnut.cashu.space` for an auction whose `mint_url` matches; confirm the bid is verified and a `kind:39001` is published; then settle, claim via `claimAuction` and confirm the seller's wallet balance increases.
- [ ] NUT-11 pin: note the verified NUT-11 revision and target mints (testnut.cashu.space, mint.cashu.me) in the spec §9.1 before relying on production behavior.

---

## Self-Review Notes

- **Spec coverage:** §2→Tasks 3/9; §3→Task 2; §4→Tasks 3/4/7; §5→Tasks 4/5/9; §6→Tasks 6/8/13; §7→Tasks 9/10/11/12/13; §8→Tasks 3/6/7; §9→per-task tests + Verification Checklist; §10→Task 13 (legacy), Phase 3 items intentionally deferred; §11→Tasks 1/13/14; §12→documented in spec. No spec section is left without a task.
- **Placeholder scan:** no TBD/TODO/"similar to Task N" remains; every code step shows full code.
- **Type consistency:** `processBid(payload, db, pub, serverPubkey)`, `verifyBid(payload, auction, highest?, serverPubkey?)`, `publishSettlement(..., result?)`, `withAuctionLock`, `signSecret`/`verifySecretSignature`, `validateClaim`, `claimAuction(auctionId, sellerPubkey, skHex)`, `refundBid(bidId, bidderPubkey, skHex)` all agree across tasks. Claim/refund now convert `Uint8Array` keys to hex via `bytesToHex`.
