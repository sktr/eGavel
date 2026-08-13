# Shipping Method Free-Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the create-listing page's hardcoded 3-option Shipping Method radio with a free-text input, and migrate legacy shipping values to neutral wording.

**Architecture:** Delete `SHIPPING_OPTIONS` from `create/page.tsx` and swap the radio group for a single styled text input driven by the existing `shipping` string state. On the server, add an idempotent data migration (D1 migration file + better-sqlite3 initDb block) that rewrites the three legacy option values to locale-agnostic wording. The address-exchange flow after settlement is unchanged.

**Tech Stack:** Next.js 15 (App Router, client component), Cloudflare Worker + Hono + D1, better-sqlite3 (local dev), vitest (`vite-plus/test` in server tests).

## Global Constraints

- Shipping Method is an **optional free-text field**: empty string is valid (means "not specified"); no validation errors.
- Label: **"Shipping Method"**; placeholder: **`e.g. Ships worldwide, insured, buyer pays shipping`**.
- Submission stays `if (shipping) body.shipping = shipping;` — empty string omits the field.
- Migration mapping (exact strings):
  - `Home delivery` → `Courier (buyer pays shipping)`
  - `Home delivery (shipping included)` → `Courier (free shipping)`
  - `In-person handoff` → `In-person handover`
- Migration is idempotent: re-running finds no rows matching the old values (safe on fresh and existing DBs).
- Preview rows render `shipping || "—"` (sidebar preview line 1165 and confirmation modal line 1346) so an unset field shows consistently with sibling rows.
- Server tests import from `"vite-plus/test"` and follow the `DB_PATH` temp-file pattern in `apps/server/tests/db.test.ts`.
- Web app has no component test harness (`apps/web/vitest.config.ts` covers `lib/**/*.test.ts` only) — the create-page change is verified by typecheck + manual browser pass.

---

### Task 1: Server migration — rewrite legacy shipping values

**Files:**
- Create: `apps/server/migrations/0002_shipping_text.sql`
- Modify: `apps/server/src/db/index.ts` (add idempotent UPDATE block after the column-migration loop, ~line 158)
- Test: `apps/server/tests/db.test.ts` (append a describe block)

**Interfaces:**
- Produces: after `initDb()`, any auction rows with `shipping` ∈ {`Home delivery`, `Home delivery (shipping included)`, `In-person handoff`} have their `shipping` rewritten to the new wording. `getAuction`/`getAllAuctions`/etc. read back the rewritten values.

- [ ] **Step 1: Write the failing migration test**

Append to `apps/server/tests/db.test.ts` (after the existing describe; keep the existing imports — `initDb`, `Db`, `fs`, `legacyAuction` helper, `vite-plus/test`):

```ts
describe("db shipping text migration", async () => {
  let db: Db
  const origPath = process.env.DB_PATH
  const testPath = `data/test-shipping-${Date.now()}.db`

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

  it("rewrites legacy shipping option values to neutral wording", async () => {
    await db.saveAuction(legacyAuction("a1"))
    await db.saveAuction(legacyAuction("a2"))
    await db.saveAuction(legacyAuction("a3"))
    // Simulate a pre-migration database: the old option values in raw SQL.
    await db.exec(
      `UPDATE auctions SET shipping = 'Home delivery' WHERE id = 'a1'; ` +
        `UPDATE auctions SET shipping = 'Home delivery (shipping included)' WHERE id = 'a2'; ` +
        `UPDATE auctions SET shipping = 'In-person handoff' WHERE id = 'a3';`,
    )

    // Re-init → the idempotent migration must rewrite the values.
    db = initDb()

    expect((await db.getAuction("a1"))!.shipping).toBe("Courier (buyer pays shipping)")
    expect((await db.getAuction("a2"))!.shipping).toBe("Courier (free shipping)")
    expect((await db.getAuction("a3"))!.shipping).toBe("In-person handover")
  })

  it("leaves free-text and empty shipping values untouched", async () => {
    await db.saveAuction(legacyAuction("a1"))
    await db.saveAuction(legacyAuction("a2"))
    await db.exec(
      `UPDATE auctions SET shipping = 'Ships from EU only' WHERE id = 'a1'; ` +
        `UPDATE auctions SET shipping = '' WHERE id = 'a2';`,
    )

    db = initDb()

    expect((await db.getAuction("a1"))!.shipping).toBe("Ships from EU only")
    expect((await db.getAuction("a2"))!.shipping).toBe("")
  })
})
```

Note: `legacyAuction` (already defined in `db.test.ts`) returns an Auction without a `shipping` field, so `saveAuction` stores `shipping: null` — the raw `UPDATE` statements then set the old values, and the migration must rewrite them.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cashu-auction/server run test -- --testNamePattern="db shipping text migration"`
Expected: FAIL — `shipping` is still `"Home delivery"` etc. (migration not yet present).

- [ ] **Step 3: Create the D1 migration file**

Create `apps/server/migrations/0002_shipping_text.sql`:

```sql
-- Rewrite legacy fixed-choice shipping option values to neutral wording
-- (see docs/superpowers/specs/2026-08-13-shipping-method-free-text-design.md).
UPDATE auctions SET shipping = 'Courier (buyer pays shipping)' WHERE shipping = 'Home delivery';
UPDATE auctions SET shipping = 'Courier (free shipping)' WHERE shipping = 'Home delivery (shipping included)';
UPDATE auctions SET shipping = 'In-person handover' WHERE shipping = 'In-person handoff';
```

- [ ] **Step 4: Add the idempotent migration to better-sqlite3 (`apps/server/src/db/index.ts`)**

Insert after the column-migration loop (after line 158, before `const insertAuction = ...`):

```ts
  // Shipping free-text migration (2026-08-13): rewrite the legacy fixed-choice
  // option values to neutral wording. Naturally idempotent — a re-run finds no
  // rows matching the old values.
  db.exec(
    `UPDATE auctions SET shipping = 'Courier (buyer pays shipping)' WHERE shipping = 'Home delivery';
     UPDATE auctions SET shipping = 'Courier (free shipping)' WHERE shipping = 'Home delivery (shipping included)';
     UPDATE auctions SET shipping = 'In-person handover' WHERE shipping = 'In-person handoff';`,
  )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cashu-auction/server run test -- --testNamePattern="db shipping text migration"`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full server suite (regression)**

Run: `pnpm --filter @cashu-auction/server run test`
Expected: all PASS (should be 112 — the 110 from before plus these 2).

- [ ] **Step 7: Commit**

```bash
git add apps/server/migrations/0002_shipping_text.sql apps/server/src/db/index.ts apps/server/tests/db.test.ts
git commit -m "feat: migrate legacy shipping option values to neutral wording"
```

---

### Task 2: Create page — free-text Shipping Method

**Files:**
- Modify: `apps/web/app/create/page.tsx`

**Interfaces:**
- Consumes: existing `shipping` string state (line 76, init `"Home delivery"` → change init to `""`).
- Produces: the Shipping Method section is a text input; submission unchanged (`if (shipping) body.shipping = shipping;`); both preview rows render `shipping || "—"`.

- [ ] **Step 1: Implement the create-page changes**

In `apps/web/app/create/page.tsx`:

(a) **Delete** the `SHIPPING_OPTIONS` constant (lines 41–57, the whole `const SHIPPING_OPTIONS = [ ... ] as const;` block).

(b) **Change the initial state** (line 78, `useState("Home delivery")`):

```tsx
  const [shipping, setShipping] = useState("");
```

(c) **Replace the reset defaults** (two occurrences of `setShipping("Home delivery")` — lines 202 and 266):

```tsx
      setShipping("");
```

(d) **Replace the Shipping Method section** (the whole block from `{/* Shipping */}` at line 861 through its closing `</div>` at line 938) with:

```tsx
          {/* Shipping Method (optional free text) */}
          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="shippingMethod"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Shipping Method{" "}
              <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>(optional)</span>
            </label>
            <input
              id="shippingMethod"
              type="text"
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
              placeholder="e.g. Ships worldwide, insured, buyer pays shipping"
              onFocus={handleFocus}
              onBlur={handleBlur}
              style={inputTextStyle}
            />
          </div>
```

(e) **Update the sidebar preview row** (line 1165, `["Shipping", shipping]`):

```tsx
              ["Shipping", shipping || "—"],
```

(f) **Update the confirmation-modal preview row** (line 1346, `["Shipping", shipping]`):

```tsx
                    ["Shipping", shipping || "—"],
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors (confirms `SHIPPING_OPTIONS` has no remaining references).

Also grep for leftovers:

```bash
grep -n "SHIPPING_OPTIONS\|Home delivery\|Tokyo" apps/web/app/create/page.tsx
```

Expected: no matches.

Manual browser check (if backend available): on `/create`, the Shipping Method field is a text input (optional), typing updates the sidebar preview, an empty field shows "—" in both previews, and a submitted listing stores the free text.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/create/page.tsx
git commit -m "feat: shipping method is a free-text input on the create page"
```

---

### Task 3: Full verification

**Files:**
- No code changes.

- [ ] **Step 1: Run the full test suites**

Run: `pnpm test && pnpm --filter @cashu-auction/web run test`
Expected: server 112/112 PASS, web 25/25 PASS.

- [ ] **Step 2: Typecheck both apps**

Run: `pnpm --filter @cashu-auction/server run typecheck && pnpm --filter @cashu-auction/web run typecheck`
Expected: no errors.

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @cashu-auction/web run build`
Expected: production build succeeds.

- [ ] **Step 4: Commit any fixups**

```bash
git status
git add -A
git commit -m "fix: final verification fixes"
```

(Only commit if there are actual changes from the verification steps.)

- [ ] **Step 5: Note the production deployment step (data migration)**

`0002_shipping_text.sql` is a **data** migration (UPDATEs), not just a schema
change. In production it must be applied to the D1 database or legacy strings
silently stay in place:

```bash
pnpm --filter @cashu-auction/server exec wrangler d1 migrations apply cashu-auction-db --remote
```

Run this as part of the deploy (before or alongside `wrangler deploy`). Do not
skip it — a skipped data migration fails silently, unlike a schema migration.
