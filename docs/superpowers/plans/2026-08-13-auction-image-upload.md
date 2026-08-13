# Auction Image Upload & Placeholder Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real image upload work (client-compressed data URLs stored in D1, max 4 per listing) and replace all debug placeholders (`[ Featured Auction ]`, `[ {item} ]`, `[ 1 ]…[ 4 ]`, `[ First Image ]`) with a designed category-based placeholder component.

**Architecture:** Client compresses images to ≤800px WebP data URLs and sends them as an `images` array to `POST /api/auctions`. The server stores the JSON array in a new `images` TEXT column (legacy `image` column kept for compatibility). List endpoints return only the first image to keep payloads small; the detail endpoint returns all. A shared `ItemPlaceholder` component renders category icons (or the item-name initial) whenever a listing has no images.

**Tech Stack:** Next.js 15 (App Router, server + client components), Cloudflare Worker + Hono + D1 (SQLite), better-sqlite3 (local dev), vitest, `@cashu-auction/shared` workspace package.

## Global Constraints

- `images` array: max **4** entries per auction (was 10 in the create UI copy).
- Client compression: long edge ≤ **800px**, `canvas.toDataURL("image/webp", 0.8)`, JPEG fallback if webp encoding throws.
- Each image string sent to the API must be ≤ **2,000,000 bytes**; more than 4 images → `400`.
- Legacy `image` column is **kept** and still written (first element) for backward compatibility. It is read back as `images` **only when renderable** (starts with `data:`, `http://`, or `https://`); bare filenames (e.g. `photo.jpg`) are treated as no image.
- List endpoints (`GET /api/auctions`, dashboard/seller/bidder lists) return `images` truncated to the **first element**; the detail endpoint (`GET /api/auctions/:id`) returns all.
- Categories (from `create/page.tsx`): `art, collectibles, watches, bags, jewelry, wine, cars, furniture, electronics, other`. Material Icons are loaded app-wide via `layout.tsx` (`.material-icons` class).
- Web tests run in a **node** environment (`apps/web/vitest.config.ts`, `include: ["lib/**/*.test.ts"]`); browser APIs must be stubbed with `vi.stubGlobal`. Component rendering is verified manually in the browser, not by unit tests.

---

### Task 1: Shared type + DB layer (`images` column)

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/db/index.ts`
- Modify: `apps/server/src/db/d1.ts`
- Create: `apps/server/migrations/0001_add_images.sql`
- Test: `apps/server/tests/images.test.ts` (DB part)

**Interfaces:**
- Produces: `Auction.images?: string[]` on the shared type. DB read functions (`getAllAuctions`, `getActiveAuctions`, `getAuction`, `getAuctionsBySeller`) return auctions whose `images` is a parsed `string[]` (or `undefined` when none/legacy-filename). `saveAuction` accepts `images?: string[]` and stores it as JSON; it also stores `image = images?.[0]` (falling back to the passed `image`).

- [ ] **Step 1: Write the failing DB tests**

Create `apps/server/tests/images.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test"
import fs from "node:fs"
import { initDb, type Db } from "../src/db/index.js"
import type { Auction } from "@cashu-auction/shared"

function auction(id: string, overrides: Partial<Auction> = {}): Auction {
  return {
    id,
    item: "t",
    description: "d",
    start_price: 100,
    reserve_price: null,
    buy_now_price: null,
    end_time: Date.now() + 3600_000,
    seller_pubkey: "02deadbeef",
    state: "ACTIVE",
    start_time: Date.now(),
    last_extended_at: null,
    winner_npub: null,
    winning_amount: null,
    mint_url: "https://mint.example",
    ...overrides,
  }
}

describe("db images column", async () => {
  let db: Db
  const origPath = process.env.DB_PATH
  const testPath = `data/test-images-${Date.now()}.db`

  beforeEach(async () => {
    process.env.DB_PATH = testPath
    for (const f of [testPath, `${testPath}-wal`, `${testPath}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    db = initDb()
  })

  afterEach(async () => {
    if (origPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = origPath
  })

  it("round-trips an images array as JSON", async () => {
    const imgs = ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"]
    await db.saveAuction(auction("a1", { images: imgs }))
    const got = (await db.getAuction("a1"))!
    expect(got.images).toEqual(imgs)
    expect(got.image).toBe(imgs[0])
  })

  it("falls back to a renderable legacy image column", async () => {
    await db.saveAuction(auction("a1", { image: "https://example.com/x.webp" }))
    const got = (await db.getAuction("a1"))!
    expect(got.images).toEqual(["https://example.com/x.webp"])
  })

  it("treats a legacy bare filename as no image", async () => {
    await db.saveAuction(auction("a1", { image: "photo.jpg" }))
    const got = (await db.getAuction("a1"))!
    expect(got.images).toBeUndefined()
  })

  it("returns images on every read path", async () => {
    const imgs = ["data:image/webp;base64,AAA"]
    await db.saveAuction(auction("a1", { images: imgs }))
    expect((await db.getActiveAuctions())[0]!.images).toEqual(imgs)
    expect((await db.getAllAuctions())[0]!.images).toEqual(imgs)
    expect((await db.getAuctionsBySeller("02deadbeef"))[0]!.images).toEqual(imgs)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cashu-auction/server run test -- --testNamePattern="db images column"`
Expected: FAIL — `got.images` is `undefined`/string, not an array.

- [ ] **Step 3: Update shared type**

`packages/shared/src/index.ts` — add `images` next to `image`:

```ts
export interface Auction {
  // ...existing fields...
  mint_url: string
  category?: string
  condition?: string
  shipping?: string
  /** Legacy single image (data URL or remote URL). Kept for backward compatibility. */
  image?: string
  /** All listing images as data URLs (max 4). */
  images?: string[]
}
```

- [ ] **Step 4: Implement better-sqlite3 side (`apps/server/src/db/index.ts`)**

(a) Add the column to `CREATE TABLE` (after `image TEXT`):

```sql
  image TEXT,
  images TEXT
```

(b) Add to the idempotent migration loop (the loop already contains the `image TEXT` entry at `apps/server/src/db/index.ts:149` — add only this new line after it):

```ts
    "ALTER TABLE auctions ADD COLUMN images TEXT",
```

(c) Update the insert statement (column list + VALUES):

```ts
  const insertAuction = db.prepare(`
    INSERT OR REPLACE INTO auctions
      (id, item, description, start_price, reserve_price, buy_now_price, end_time, seller_pubkey, state, start_time, last_extended_at, winner_npub, winning_amount, mint_url, category, condition, shipping, image, images)
    VALUES
      (@id, @item, @description, @start_price, @reserve_price, @buy_now_price, @end_time, @seller_pubkey, @state, @start_time, @last_extended_at, @winner_npub, @winning_amount, @mint_url, @category, @condition, @shipping, @image, @images)
  `)
```

(d) Add a row-normalization helper inside `initDb()` (used by every read):

```ts
  function parseRow(row: Auction): Auction {
    if (typeof row.images === "string") {
      try {
        row.images = JSON.parse(row.images) as string[]
      } catch {
        delete row.images
      }
    }
    if (!Array.isArray(row.images) && typeof row.image === "string") {
      if (/^(data:|https?:\/\/)/.test(row.image)) row.images = [row.image]
    }
    return row
  }
```

(e) Wrap every auction read with `parseRow`:

```ts
    async getActiveAuctions() {
      return (db
        .prepare("SELECT * FROM auctions WHERE state = 'ACTIVE' OR state = 'EXTENDED'")
        .all() as Auction[]).map(parseRow)
    },

    async getAllAuctions() {
      return (db
        .prepare("SELECT * FROM auctions ORDER BY end_time DESC")
        .all() as Auction[]).map(parseRow)
    },

    async getAuction(id: string) {
      const row = db.prepare("SELECT * FROM auctions WHERE id = ?").get(id) as Auction | undefined
      return row ? parseRow(row) : null
    },
```

(f) Update `saveAuction`:

```ts
    async saveAuction(auction: Auction) {
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
        image: auction.images?.[0] ?? auction.image ?? null,
        images: auction.images ? JSON.stringify(auction.images) : null,
      })
    },
```

(g) `getAuctionsBySeller` — wrap with `.map(parseRow)`:

```ts
    async getAuctionsBySeller(sellerPubkey: string) {
      return (db
        .prepare("SELECT * FROM auctions WHERE seller_pubkey = ? ORDER BY end_time DESC")
        .all(sellerPubkey) as Auction[]).map(parseRow)
    },
```

- [ ] **Step 5: Implement D1 side (`apps/server/src/db/d1.ts`)**

(a) Update the insert SQL + binds:

```ts
        .prepare(
          `INSERT OR REPLACE INTO auctions
            (id, item, description, start_price, reserve_price, buy_now_price, end_time, seller_pubkey, state, start_time, last_extended_at, winner_npub, winning_amount, mint_url, category, condition, shipping, image, images)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          auction.id,
          auction.item,
          auction.description,
          auction.start_price,
          auction.reserve_price,
          auction.buy_now_price,
          auction.end_time,
          auction.seller_pubkey,
          auction.state,
          auction.start_time,
          auction.last_extended_at,
          auction.winner_npub,
          auction.winning_amount,
          auction.mint_url,
          auction.category ?? null,
          auction.condition ?? null,
          auction.shipping ?? null,
          auction.images?.[0] ?? auction.image ?? null,
          auction.images ? JSON.stringify(auction.images) : null,
        )
        .run()
```

(b) Add the same `parseRow` helper and map over the four read paths:

```ts
  function parseRow(row: Auction): Auction {
    if (typeof row.images === "string") {
      try {
        row.images = JSON.parse(row.images) as string[]
      } catch {
        delete row.images
      }
    }
    if (!Array.isArray(row.images) && typeof row.image === "string") {
      if (/^(data:|https?:\/\/)/.test(row.image)) row.images = [row.image]
    }
    return row
  }
```

```ts
    async getActiveAuctions() {
      const { results } = await d1
        .prepare("SELECT * FROM auctions WHERE state = 'ACTIVE' OR state = 'EXTENDED'")
        .all<Auction>()
      return results.map(parseRow)
    },

    async getAllAuctions() {
      const { results } = await d1
        .prepare("SELECT * FROM auctions ORDER BY end_time DESC")
        .all<Auction>()
      return results.map(parseRow)
    },

    async getAuction(id: string) {
      const row = await d1.prepare("SELECT * FROM auctions WHERE id = ?").bind(id).first<Auction>()
      return row ? parseRow(row) : null
    },

    async getAuctionsBySeller(sellerPubkey: string) {
      const { results } = await d1
        .prepare("SELECT * FROM auctions WHERE seller_pubkey = ? ORDER BY end_time DESC")
        .bind(sellerPubkey)
        .all<Auction>()
      return results.map(parseRow)
    },
```

- [ ] **Step 6: Add the D1 migration file**

Create `apps/server/migrations/0001_add_images.sql`:

```sql
-- Add multi-image support: JSON array of data URLs (max 4 per listing).
ALTER TABLE auctions ADD COLUMN images TEXT;
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @cashu-auction/server run test -- --testNamePattern="db images column"`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/index.ts apps/server/src/db/index.ts apps/server/src/db/d1.ts apps/server/migrations/0001_add_images.sql apps/server/tests/images.test.ts
git commit -m "feat: add images column (JSON array) to auction storage with legacy fallback"
```

---

### Task 2: API routes — accept `images`, truncate lists to first image

**Files:**
- Modify: `apps/server/src/routes/auctions.ts`
- Test: `apps/server/tests/images.test.ts` (API part)

**Interfaces:**
- Consumes: `Auction.images?: string[]` from Task 1; `db.saveAuction`, `db.getAuction`, `db.getAllAuctions`, `db.getActiveAuctions`, `db.getAuctionsBySeller`.
- Produces: `POST /api/auctions` accepts `images: string[]` (max 4, each ≤ 2,000,000 chars) and persists `images` + legacy `image`. `GET /api/auctions` and `GET /api/auctions?filter=active` return `images` truncated to the first element; `GET /api/auctions/:id` returns the full array.

- [ ] **Step 1: Write the failing API tests**

Append to `apps/server/tests/images.test.ts`:

```ts
import { Hono } from "hono"
import { createAuctionRoutes } from "../src/routes/auctions.js"
import type { Auction } from "@cashu-auction/shared"

describe("POST /api/auctions with images", async () => {
  let db: Db
  let app: Hono
  let testPath = ""
  const origPath = process.env.DB_PATH

  beforeEach(async () => {
    testPath = `data/test-images-api-${Date.now()}.db`
    for (const f of [testPath, `${testPath}-wal`, `${testPath}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    process.env.DB_PATH = testPath
    db = initDb()
    app = new Hono()
    app.route("/api", createAuctionRoutes(db))
  })

  afterEach(async () => {
    for (const f of [testPath, `${testPath}-wal`, `${testPath}-shm`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    if (origPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = origPath
  })

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      item: "test item",
      description: "desc",
      start_price: 100,
      end_time: Date.now() + 3600_000,
      seller_pubkey: "02deadbeef",
      mint_url: "https://mint.example",
      ...overrides,
    }
  }

  it("persists an images array and derives legacy image", async () => {
    const imgs = ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"]
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody({ images: imgs })),
    })
    expect(res.status).toBe(200)
    const auction = (await res.json()) as Auction
    expect(auction.images).toEqual(imgs)
    expect(auction.image).toBe(imgs[0])
    expect((await db.getAuction(auction.id))?.images).toEqual(imgs)
  })

  it("rejects more than 4 images", async () => {
    const imgs = Array.from({ length: 5 }, (_, i) => `data:image/webp;base64,${i}`)
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody({ images: imgs })),
    })
    expect(res.status).toBe(400)
  })

  it("rejects an oversized image string", async () => {
    const res = await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody({ images: ["data:image/webp;base64," + "x".repeat(2_000_001)] })),
    })
    expect(res.status).toBe(400)
  })

  it("list endpoints truncate images to the first element", async () => {
    const imgs = ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"]
    await app.request("http://localhost/api/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody({ images: imgs })),
    })
    const list = (await (await app.request("http://localhost/api/auctions")).json()) as Auction[]
    expect(list[0]!.images).toEqual([imgs[0]])
    const active = (await (await app.request("http://localhost/api/auctions?filter=active")).json()) as Auction[]
    expect(active[0]!.images).toEqual([imgs[0]])
  })

  it("detail endpoint returns all images", async () => {
    const imgs = ["data:image/webp;base64,AAA", "data:image/webp;base64,BBB"]
    const created = (await (
      await app.request("http://localhost/api/auctions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody({ images: imgs })),
      })
    ).json()) as Auction
    const detail = (await (await app.request(`http://localhost/api/auctions/${created.id}`)).json()) as Auction
    expect(detail.images).toEqual(imgs)
  })
})
```

Note: the top-of-file imports must be updated — `describe`/`it`/`expect`/`beforeEach`/`afterEach` from `"vite-plus/test"`, `fs` from `"node:fs"`, `initDb`/`Db` from `"../src/db/index.js"`, `Hono` from `"hono"`, `createAuctionRoutes` from `"../src/routes/auctions.js"`, `Auction` from `"@cashu-auction/shared"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cashu-auction/server run test -- --testNamePattern="POST /api/auctions with images"`
Expected: FAIL — `images` is not persisted; list endpoints return the full array (or none).

- [ ] **Step 3: Implement route changes (`apps/server/src/routes/auctions.ts`)**

(a) In `POST /api/auctions`, after the existing field validation (after the `mintUrl`/`startPrice` checks), add images validation:

```ts
    // Images: optional array of data URLs, max 4, each ≤ 2MB.
    let images: string[] | undefined;
    if (body.images !== undefined) {
      if (
        !Array.isArray(body.images) ||
        body.images.length > 4 ||
        body.images.some(
          (img) => typeof img !== "string" || img.length > 2_000_000,
        )
      ) {
        return c.json(
          { error: "images must be an array of at most 4 strings, each ≤ 2MB" },
          400,
        );
      }
      images = body.images as string[];
    }
```

(b) In the `auction` object literal, replace the existing `image` spread with:

```ts
      ...(images
        ? { images, image: images[0] }
        : typeof body.image === "string" && body.image
          ? { image: body.image }
          : {}),
```

(c) In `GET /api/auctions`, truncate every returned auction to its first image (replace `return c.json(settled);`):

```ts
    const listed = settled.map((a) =>
      a.images ? { ...a, images: a.images.slice(0, 1) } : a,
    );
    return c.json(listed);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cashu-auction/server run test -- --testNamePattern="with images"`
Expected: PASS.

- [ ] **Step 5: Run the full server suite (regression)**

Run: `pnpm --filter @cashu-auction/server run test`
Expected: all tests PASS (including the pre-existing `POST /api/auctions` tests in `claim.test.ts`, which still send `image: "https://example.com/x.webp"`).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/auctions.ts apps/server/tests/images.test.ts
git commit -m "feat: accept images array on create; truncate list endpoints to first image"
```

---

### Task 3: Client image compression helper

**Files:**
- Create: `apps/web/lib/image.ts`
- Test: `apps/web/lib/image.test.ts`

**Interfaces:**
- Produces: `export async function compressImage(file: File, maxEdge?: number): Promise<string | null>` — returns a `data:image/webp;base64,...` string (maxEdge default 800) or `null` on decode failure / unsupported input. Used by Task 6 (create page).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/image.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { compressImage } from "./image"

class FakeImage {
  naturalWidth = 1600
  naturalHeight = 800
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_v: string) {
    queueMicrotask(() => this.onload?.())
  }
}

class FakeFileReader {
  result: string | null = "data:image/png;base64,AAAA"
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL() {
    queueMicrotask(() => this.onload?.())
  }
}

// Single shared canvas instance: compressImage mutates the element it gets from
// createElement, and the tests assert on that same mutated object — so every
// createElement("canvas") call must return the SAME instance, not a fresh one.
const fakeCanvasEl = {
  width: 0,
  height: 0,
  getContext: () => ({ drawImage: vi.fn() }),
  toDataURL: (type: string, quality: number) => `data:${type};base64,fake-${quality}`,
}

describe("compressImage", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", FakeFileReader)
    vi.stubGlobal("Image", FakeImage)
    vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "canvas" ? fakeCanvasEl : {}),
    })
    fakeCanvasEl.width = 0
    fakeCanvasEl.height = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it("downscales a large image to maxEdge and returns a webp data URL", async () => {
    const out = await compressImage({} as File, 800)
    expect(out).toBe("data:image/webp;base64,fake-0.8")
    const canvas = document.createElement("canvas") as { width: number; height: number }
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(400)
  })

  it("keeps a small image at native size", async () => {
    // naturalWidth/naturalHeight are 1600x800, so request a bigger edge
    const out = await compressImage({} as File, 2000)
    expect(out).toBe("data:image/webp;base64,fake-0.8")
    const canvas = document.createElement("canvas") as { width: number; height: number }
    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(800)
  })

  it("returns null when the image fails to load", async () => {
    class BrokenImage {
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal("Image", BrokenImage)
    const out = await compressImage({} as File, 800)
    expect(out).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cashu-auction/web run test`
Expected: FAIL — `image.ts` does not exist.

- [ ] **Step 3: Implement `apps/web/lib/image.ts`**

```ts
/**
 * Read an image File, downscale the longer edge to `maxEdge` px, and return a
 * WebP data URL (quality 0.8). Returns null when the file cannot be decoded.
 */
export async function compressImage(
  file: File,
  maxEdge = 800,
): Promise<string | null> {
  try {
    const dataUrl = await readAsDataURL(file)
    if (!dataUrl) return null
    const img = await loadImage(dataUrl)
    if (!img || !img.naturalWidth || !img.naturalHeight) return null

    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, width, height)

    try {
      return canvas.toDataURL("image/webp", 0.8)
    } catch {
      return canvas.toDataURL("image/jpeg", 0.8)
    }
  } catch {
    return null
  }
}

function readAsDataURL(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cashu-auction/web run test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/image.ts apps/web/lib/image.test.ts
git commit -m "feat: add client-side image compression helper (webp data URL)"
```

---

### Task 4: Category placeholder lookup (pure logic)

**Files:**
- Create: `apps/web/lib/placeholder.ts`
- Test: `apps/web/lib/placeholder.test.ts`

**Interfaces:**
- Produces:
  - `export function placeholderFor(category?: string): { icon: string; bg: string; fg: string }`
  - `export function itemInitial(name?: string): string`
  - `export const CATEGORY_PLACEHOLDERS: Record<string, { icon: string; bg: string; fg: string }>`
- Consumed by: `ItemPlaceholder` component (Task 5), create-page preview (Task 6), hero (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/placeholder.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { placeholderFor, itemInitial, CATEGORY_PLACEHOLDERS } from "./placeholder"

describe("placeholderFor", () => {
  it("maps every category to an icon + colors", () => {
    for (const cat of [
      "art",
      "collectibles",
      "watches",
      "bags",
      "jewelry",
      "wine",
      "cars",
      "furniture",
      "electronics",
      "other",
    ]) {
      const p = placeholderFor(cat)
      expect(p.icon).toBeTruthy()
      expect(p.bg).toBeTruthy()
      expect(p.fg).toBeTruthy()
    }
  })

  it("falls back to the neutral style for unknown/empty categories", () => {
    expect(placeholderFor()).toEqual(CATEGORY_PLACEHOLDERS.other)
    expect(placeholderFor("nonexistent")).toEqual(CATEGORY_PLACEHOLDERS.other)
  })
})

describe("itemInitial", () => {
  it("returns the uppercased first character", () => {
    expect(itemInitial("Rolex Submariner")).toBe("R")
    expect(itemInitial("  hello")).toBe("H")
  })
  it("falls back to '?' for empty input", () => {
    expect(itemInitial()).toBe("?")
    expect(itemInitial("   ")).toBe("?")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cashu-auction/web run test`
Expected: FAIL — `placeholder.ts` does not exist.

- [ ] **Step 3: Implement `apps/web/lib/placeholder.ts`**

```ts
export interface PlaceholderStyle {
  icon: string
  bg: string
  fg: string
}

/** Category value → material icon + tinted colors (categories from create/page.tsx). */
export const CATEGORY_PLACEHOLDERS: Record<string, PlaceholderStyle> = {
  art: { icon: "palette", bg: "#fdf0f2", fg: "#c2567a" },
  collectibles: { icon: "diamond", bg: "#f4f0fb", fg: "#7a5bb0" },
  watches: { icon: "watch", bg: "#eef2fb", fg: "#3e6bd6" },
  bags: { icon: "checkroom", bg: "#f7f0e8", fg: "#9a6b3a" },
  jewelry: { icon: "diamond", bg: "#f4f0fb", fg: "#7a5bb0" },
  wine: { icon: "wine_bar", bg: "#fbecec", fg: "#b04444" },
  cars: { icon: "directions_car", bg: "#eef2fb", fg: "#3e6bd6" },
  furniture: { icon: "chair", bg: "#faf0e2", fg: "#b3813a" },
  electronics: { icon: "memory", bg: "#eef0f2", fg: "#5c6672" },
  other: { icon: "inventory_2", bg: "#f0f1f3", fg: "#6b7280" },
}

export function placeholderFor(category?: string): PlaceholderStyle {
  return CATEGORY_PLACEHOLDERS[category ?? ""] ?? CATEGORY_PLACEHOLDERS.other!
}

export function itemInitial(name?: string): string {
  const c = (name ?? "").trim().charAt(0)
  return c ? c.toUpperCase() : "?"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cashu-auction/web run test`
Expected: PASS (2 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/placeholder.ts apps/web/lib/placeholder.test.ts
git commit -m "feat: add category placeholder lookup (icon + tinted colors)"
```

---

### Task 5: `ItemPlaceholder` component + card rendering

**Files:**
- Create: `apps/web/components/item-placeholder.tsx`
- Modify: `apps/web/app/auction-card.tsx`

**Interfaces:**
- Consumes: `placeholderFor`, `itemInitial` from Task 4; `Auction` type.
- Produces: `export function ItemPlaceholder({ category, name, size = 28, style }: { category?: string; name?: string; size?: number; style?: React.CSSProperties })` — renders a category icon (known category) or the item-name initial (unknown/empty category) on a tinted background filling its parent.
- Renders in `AuctionCard`: `a.images?.[0]` as `<img>` (`object-fit: cover`) when present, else `ItemPlaceholder`.

- [ ] **Step 1: Implement `apps/web/components/item-placeholder.tsx`**

```tsx
import type { CSSProperties } from "react"
import { CATEGORY_PLACEHOLDERS, placeholderFor, itemInitial } from "../lib/placeholder"

export function ItemPlaceholder({
  category,
  name,
  size = 28,
  style,
}: {
  category?: string
  name?: string
  size?: number
  style?: CSSProperties
}) {
  const known = !!category && category in CATEGORY_PLACEHOLDERS
  const p = placeholderFor(category)
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: p.bg,
        color: p.fg,
        ...style,
      }}
    >
      {known ? (
        <span className="material-icons" style={{ fontSize: size }}>
          {p.icon}
        </span>
      ) : (
        <span style={{ fontSize: Math.round(size * 0.9), fontWeight: 700, letterSpacing: "0.02em" }}>
          {itemInitial(name)}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `apps/web/app/auction-card.tsx`**

(a) Add the import:

```tsx
import { ItemPlaceholder } from "../components/item-placeholder"
```

(b) Replace the image area (currently lines 26–32) with:

```tsx
      <div style={{
        aspectRatio: "4/3", background: "var(--placeholder)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--muted)", fontSize: 13, overflow: "hidden",
      }}>
        {a.images?.[0] ? (
          <img
            src={a.images[0]}
            alt={a.item}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <ItemPlaceholder category={a.category} name={a.item} size={36} />
        )}
      </div>
```

- [ ] **Step 3: Verify card renders**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

Manual browser check: `pnpm --filter @cashu-auction/web run dev`, open `/` — cards with an `images[0]` show the image; cards without show a category icon (or initial). No `[ {a.item} ]` text anywhere.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/item-placeholder.tsx apps/web/app/auction-card.tsx
git commit -m "feat: render listing images on cards; category placeholder fallback"
```

---

### Task 6: Create page — real image upload pipeline

**Files:**
- Modify: `apps/web/app/create/page.tsx`

**Interfaces:**
- Consumes: `compressImage` from Task 3, `ItemPlaceholder` from Task 5.
- Produces: `images` state holds data URLs (max 4); `POST` sends `body.images` + `body.image`; upload thumbnails and preview card render real images.

- [ ] **Step 1: Implement the changes in `apps/web/app/create/page.tsx`**

(a) Add imports at the top:

```tsx
import { compressImage } from "../../lib/image"
import { ItemPlaceholder } from "../../components/item-placeholder"
```

(b) Replace `handleFileChange` (currently lines 210–217) with an async version that compresses and caps at 4:

```tsx
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) {
      const results = await Promise.all(Array.from(files).map((f) => compressImage(f)));
      const ok = results.filter((r): r is string => r !== null);
      setImages((prev) => [...prev, ...ok].slice(0, 4));
    }
    if (fileRef.current) fileRef.current.value = "";
  }
```

(c) In `handleConfirm`, replace the single-image line (currently `if (images.length > 0) body.image = images[0];`) with:

```tsx
      if (images.length > 0) {
        body.image = images[0];
        body.images = images;
      }
```

(d) Update the label copy "(max 10)" → "(max 4)" (line 384).

(e) Replace the upload thumbnail rendering (currently lines 446–509: the `images.map((name, i) => (...))` block **plus** the add-tile condition `{images.length < 10 && (` at line 509) — render the real `<img>` instead of the icon + filename text, keep the remove button, and change the add-tile cap from `< 10` to `< 4`. The replacement below covers the whole 446–529 block through the add-tile's closing `)}`:

```tsx
                {images.map((src, i) => (
                  <div
                    key={`${src.slice(0, 24)}-${i}`}
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: "var(--radius)",
                      background: "#f3f4f6",
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--muted)",
                      fontSize: 10,
                      position: "relative",
                      overflow: "hidden",
                    }}
                    title={`Image ${i + 1}`}
                  >
                    <img
                      src={src}
                      alt={`Image ${i + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(i);
                      }}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "var(--fg)",
                        color: "#fff",
                        border: "none",
                        fontSize: 11,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        lineHeight: 1,
                      }}
                    >
                      <span className="material-icons" style={{ fontSize: 11 }}>
                        close
                      </span>
                    </button>
                  </div>
                ))}
                {images.length < 4 && (
```

(f) Replace the preview card image area (currently line 1144, `{images.length > 0 ? "[ First Image ]" : "[ No Image ]"}`) — the parent div keeps its `aspectRatio: "16/10"` / `borderRadius` / `overflow` needs; render a real preview:

```tsx
            <div
              style={{
                aspectRatio: "16/10",
                background: "#f3f4f6",
                borderRadius: "var(--radius)",
                marginBottom: 16,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {images[0] ? (
                <img
                  src={images[0]}
                  alt="Preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <ItemPlaceholder category={category} name={item} size={32} />
              )}
            </div>
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

Manual browser check: on `/create`, select an image file → a real thumbnail preview appears (max 4); the sidebar Preview shows the first image (or the category placeholder); submit → the listing card on `/` shows the uploaded image.

Note: `handleSaveDraft` (unchanged, `create/page.tsx:223–246`) persists the `images` state — which now holds up to 4 WebP data URLs (~100 KB each) instead of filenames. Repeated draft saves approach localStorage's ~5 MB quota. Out of scope for this spec; do not fix here.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/create/page.tsx
git commit -m "feat: upload real images on the create page (compress, preview, max 4)"
```

---

### Task 7: Detail page — gallery client component

**Files:**
- Create: `apps/web/app/auctions/[id]/gallery.tsx`
- Modify: `apps/web/app/auctions/[id]/page.tsx`

**Interfaces:**
- Consumes: `Auction` type, `ItemPlaceholder`.
- Produces: `export function Gallery({ auction }: { auction: Auction })` — client component: main image (first image or placeholder) + thumbnail row (one per image, click to switch, accent border on the selected one; hidden entirely when no images).

- [ ] **Step 1: Implement `apps/web/app/auctions/[id]/gallery.tsx`**

```tsx
"use client"

import { useState } from "react"
import type { Auction } from "@cashu-auction/shared"
import { ItemPlaceholder } from "../../../components/item-placeholder"

export function Gallery({ auction }: { auction: Auction }) {
  const images = auction.images ?? []
  const [active, setActive] = useState(0)
  const current = images[active] ?? images[0]
  const isOpen = auction.state === "ACTIVE" || auction.state === "EXTENDED"

  return (
    <div>
      {/* Main image */}
      <div
        style={{
          aspectRatio: "4 / 3",
          background: "var(--placeholder)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: 14,
          marginBottom: 8,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {current ? (
          <img
            src={current}
            alt={auction.item}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <ItemPlaceholder category={auction.category} name={auction.item} size={40} />
        )}
        {isOpen && (
          <span
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 999,
              font: "600 12px/1.3 -apple-system, sans-serif",
              letterSpacing: "0.02em",
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            <span className="material-icons" style={{ fontSize: 14 }}>
              local_fire_department
            </span>{" "}
            {auction.state === "EXTENDED" ? "Extended" : "Active"}
          </span>
        )}
      </div>

      {/* Thumbnails — only when there are images */}
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8 }}>
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Image ${i + 1}`}
              style={{
                width: 72,
                height: 56,
                padding: 0,
                border: i === active ? "2px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: 4,
                overflow: "hidden",
                cursor: "pointer",
                background: "var(--placeholder)",
                boxSizing: "border-box",
              }}
            >
              <img
                src={src}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `apps/web/app/auctions/[id]/page.tsx`**

(a) Add the import:

```tsx
import { Gallery } from "./gallery"
```

(b) Replace the entire LEFT COLUMN gallery markup — from `{/* ===== LEFT COLUMN: Gallery ===== */}` through the closing `</div>` of the thumbnails row (currently lines 64–133) — with:

```tsx
        {/* ===== LEFT COLUMN: Gallery ===== */}
        <Gallery auction={auction} />
```

(c) Delete the now-unused `const isOpen = ...` in `apps/web/app/auctions/[id]/page.tsx` (currently line 33) — the Active/Extended badge moved into `Gallery`, so this constant is dead code.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

Manual browser check: open `/auctions/{id}` — main image shows the first image (or placeholder); thumbnails render per image and switch on click; no `[ 1 ]…[ 4 ]` boxes; with no images the thumbnail row is absent.

Coverage note: Tasks 1–2 exercise only the better-sqlite3 `Db` via `initDb()`. There is no `createD1Db` test harness in this repo, so the D1 `parseRow` and the 19-column/19-placeholder INSERT (Task 1 Step 5(a)) ship untested — a placeholder-count mismatch there would only surface in production. Verify the D1 INSERT bind count against its `?` count by eye during Task 1 Step 5.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/auctions/[id]/gallery.tsx apps/web/app/auctions/[id]/page.tsx
git commit -m "feat: detail page gallery with real images and clickable thumbnails"
```

---

### Task 8: Top hero — show latest active auction, hide when empty

**Files:**
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `Auction` type, `ItemPlaceholder`.
- Produces: server component `Home` fetches active auctions, passes the soonest-ending one to the hero; hero box shows its image (or placeholder) and links to the detail page; when no active auctions exist the box is hidden and the hero is single-column.

- [ ] **Step 1: Implement `apps/web/app/page.tsx`**

Replace the whole file with:

```tsx
import type { Auction } from "@cashu-auction/shared"
import { AuctionList } from "./auction-list"
import { ItemPlaceholder } from "../components/item-placeholder"

const API_BASE = process.env.SSR_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api"

export default async function Home() {
  let featured: Auction | null = null
  try {
    const res = await fetch(`${API_BASE}/auctions?filter=active`, { cache: "no-store" })
    if (res.ok) {
      const active = (await res.json()) as Auction[]
      featured = active.sort((a, b) => a.end_time - b.end_time)[0] ?? null
    }
  } catch {
    // hero simply stays hidden
  }
  const featuredImage = featured?.images?.[0]

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* Hero */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: featured ? "1fr 1fr" : "1fr",
          gap: 40,
          padding: "64px 0 40px",
          alignItems: "center",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(28px,4vw,44px)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              marginBottom: 16,
            }}
          >
            Peer-to-peer auctions
            <br />
            on Cashu e-cash
          </h1>
          <p
            style={{
              color: "var(--muted)",
              fontSize: 16,
              marginBottom: 24,
              maxWidth: 440,
              lineHeight: 1.5,
            }}
          >
            Bid with sats, settle instantly. No account, no custody — your keys, your coins.
          </p>
          <a
            href="/create"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "10px 20px",
              fontSize: 15,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            Create Auction{" "}
            <span className="material-icons" style={{ fontSize: 16, verticalAlign: "text-bottom" }}>
              arrow_forward
            </span>
          </a>
        </div>
        {featured && (
          <a
            href={`/auctions/${featured.id}`}
            style={{
              display: "block",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              overflow: "hidden",
              textDecoration: "none",
              color: "inherit",
              transition: "box-shadow .2s",
            }}
          >
            <div
              style={{
                aspectRatio: "16/10",
                background: "var(--placeholder)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: 14,
                position: "relative",
              }}
            >
              {featuredImage ? (
                <img
                  src={featuredImage}
                  alt={featured.item}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <ItemPlaceholder category={featured.category} name={featured.item} size={48} />
              )}
            </div>
            <div style={{ padding: "10px 14px", fontWeight: 600, fontSize: 14 }}>
              {featured.item}
            </div>
          </a>
        )}
      </section>

      <AuctionList />
    </main>
  )
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

Manual browser check: with active auctions, the hero shows the soonest-ending listing's image and name, linking to its page. With zero active auctions (fresh DB), the hero is single-column — no empty `[ Featured Auction ]` box.

Note: `Home` adds a second fetch on `/` (`?filter=active`) alongside `AuctionList`'s own fetch. This matches the plan's stated approach; if the extra round-trip matters later, derive the soonest-ending auction from `AuctionList`'s fetch instead.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat: hero shows latest active auction; hidden when none active"
```

---

### Task 9: Full verification

**Files:**
- No code changes.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all server tests PASS (includes `images.test.ts`), plus `pnpm --filter @cashu-auction/web run test` if `pnpm test` only covers server (root `test` script runs only the server package — run web tests explicitly): `pnpm --filter @cashu-auction/web run test`. All PASS.

- [ ] **Step 2: Typecheck both apps**

Run: `pnpm --filter @cashu-auction/server run typecheck && pnpm --filter @cashu-auction/web run typecheck`
Expected: no errors.

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @cashu-auction/web run build`
Expected: production build succeeds.

- [ ] **Step 4: End-to-end manual pass (browser)**

With `pnpm dev` (server + web):
1. `/` — hero shows an active listing or is single-column; cards show images or category placeholders.
2. `/create` — upload 4 images → previews + first-image preview; listing without images still creates.
3. `/auctions/{id}` — gallery with thumbnails; image-less listing shows placeholder and no thumbnail row.
4. Create a listing with images via the API and confirm list vs detail responses (`GET /api/auctions` returns 1 image, `GET /api/auctions/:id` returns all).

- [ ] **Step 5: Commit any fixups**

```bash
git status
git add -A
git commit -m "fix: final verification fixes"
```

(Only commit if there are actual changes from the verification steps.)
