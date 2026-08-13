# Shipping Method Free-Text Redesign Spec

Date: 2026-08-13
Status: accepted (design approved; implementation is based on this spec)

---

## 1. Background and Problems

The create-listing form offers a hardcoded three-way Shipping Method radio
choice (`apps/web/app/create/page.tsx`, `SHIPPING_OPTIONS`):

| value | title | desc |
|-------|-------|------|
| `Home delivery` | Courier | Nationwide, insured — buyer pays shipping |
| `Home delivery (shipping included)` | Courier (Free Shipping) | Nationwide, insured — seller pays shipping |
| `In-person handoff` | Hand Delivery | In-person handover — Tokyo area |

Problems:

1. **"Tokyo area" is locale-specific.** The app is English-only and targets a
   global, international audience (Cashu is a worldwide e-cash protocol). A
   handover option scoped to Tokyo makes no sense to users outside Japan.
2. **The choice is meaningless in practice.** The selected value is stored on
   the auction (`shipping` TEXT) and shown only in the create-page previews —
   it is **not** rendered on the detail page's details table (the table has
   rows for Start Price / Status / Start Date / End Date / Seller / Winner /
   Winning Amount only). It does not affect payment, escrow, or any logic —
   who pays shipping is never enforced. A fixed 3-choice list therefore adds
   no value over a free-text description and actively constrains what a
   seller can state (e.g. "ships from EU only", "no international shipping").
3. **The stored values are Japan-centric strings** that will age poorly.

Additionally, the address-exchange flow after an auction settles was
re-examined. Nostr (which previously would have let users message each
other) was removed in the de-Nostr refactor (commit `369f248`). The current
flow is a signed server relay: winner submits a Schnorr-signed address to
`POST /api/auctions/:id/shipping`, the server stores it, and the seller
reads it via `GET /api/auctions/:id/shipping` (seller key required) on the
dashboard. The operator is not involved in shipping itself — fulfillment is
an offline contract between winner and seller.

## 2. Decisions (agreed during brainstorming)

| Decision | Choice |
|----------|--------|
| Shipping Method control | Replace the 3-option radio with a **free-text input** |
| Existing data | **Migrate** old option values to generic wording (SQL UPDATE) |
| Address exchange | **Keep as-is** (signed server relay; operator not involved in fulfillment) |
| Default / required | Optional field, empty by default |

Rationale for keeping the server relay: this app's threat model
(`docs/security.md`) already trusts the operator (OSS code, self-hosting,
operator reputation). Encrypting the address at rest (X25519 + AES-GCM
with the seller's pubkey) is technically possible with existing
dependencies (`@noble/curves`, Web Crypto) but adds key-management
complexity (seller secret-key loss ⇒ address unrecoverable ⇒ no shipment)
and backward-compatibility burden for no security gain within the trusted-
operator model. Out of scope.

## 3. Create-page changes (`apps/web/app/create/page.tsx`)

1. **Delete** `SHIPPING_OPTIONS` (lines 41–57).
2. Replace the radio group (currently lines 861–913, the "Shipping Method"
   section) with a single text input:
   - Label: "Shipping Method"
   - `shipping` state stays `string`, initial value `""`
   - Placeholder: `e.g. Ships worldwide, insured, buyer pays shipping`
   - Style: reuse the existing `inputTextStyle` and focus/blur handlers used
     by the other form inputs
   - Optional — no validation, no required marker
3. Submission logic stays: `if (shipping) body.shipping = shipping;`
   (empty string ⇒ field omitted from the payload, unchanged).
4. Sidebar preview rows: the "Shipping" row (line 1165) currently renders
   `["Shipping", shipping]` — with an empty string it would show a blank
   value while sibling rows fall back to "—" / "None" / "Not set". Change
   the preview entry to `["Shipping", shipping || "—"]` so an unset field
   renders consistently. (The second preview at line 1346 is the
   confirmation modal — apply the same `shipping || "—"` fallback there.)

## 4. Data migration (old values → generic wording)

Translate the three legacy option values to neutral, locale-agnostic text:

| Legacy value (DB) | New value |
|-------------------|-----------|
| `Home delivery` | `Courier (buyer pays shipping)` |
| `Home delivery (shipping included)` | `Courier (free shipping)` |
| `In-person handoff` | `In-person handover` |

- **D1:** create `apps/server/migrations/0002_shipping_text.sql` with the
  three `UPDATE auctions SET shipping = ... WHERE shipping = ...` statements.
- **better-sqlite3** (`apps/server/src/db/index.ts`): add the same three
  `UPDATE` statements as an idempotent migration block (guarded so re-runs
  are safe — the statements are naturally idempotent: a second run finds no
  rows matching the old values).

## 5. Display

- Detail page (`apps/web/app/auctions/[id]/page.tsx`) and dashboard: **no
  change**. The detail page does not currently render the auction's
  `shipping` field (its details table has no Shipping row) — this spec does
  not add one; that is a possible follow-up. The dashboard's "Shipping"
  section is the winner's address relay, unrelated to this field.
- Consumers of `auction.shipping`: the create-page sidebar preview and the
  confirmation modal only (verified by grep). Both render `shipping || "—"`.

## 6. Address exchange flow (unchanged, for the record)

```
1. Auction settles → winner sees the Checkout form on the detail page.
2. Winner enters address + note → Schnorr-signed POST /api/auctions/:id/shipping.
3. Server verifies signature (winner key) → stores in shipping table.
4. Seller reads it on the dashboard (GET /api/auctions/:id/shipping, seller key).
5. Fulfillment is an offline contract between winner and seller — the
   operator is not involved.
```

## 7. Error handling

- Free-text shipping: no validation errors. Empty string is valid (means
  "not specified").
- Migration: idempotent; safe to run on fresh and existing databases.
- No new API surface; no new failure modes beyond the existing form submit.

## 8. Testing

- **Server** (`apps/server/tests/`):
  - Migration test (better-sqlite3): insert auctions with the three legacy
    `shipping` values, run `initDb()` again (re-apply migrations), assert
    the values are rewritten to the new wording. (Follow the pattern in
    `db.test.ts`.)
  - D1 migration is verified by eye (0002 file contents); no D1 test
    harness exists in the repo (pre-existing condition).
- **Web**:
  - `apps/web` tests cover `lib/**/*.test.ts` only — the create page is not
    unit-tested. Verification is `pnpm --filter @cashu-auction/web run
    typecheck` plus a manual browser pass on `/create` (input renders,
    optional, preview shows the text, submission stores it).

## 9. Files touched

| File | Change |
|------|--------|
| `apps/web/app/create/page.tsx` | delete `SHIPPING_OPTIONS`, radio → text input |
| `apps/server/migrations/0002_shipping_text.sql` | new — 3 UPDATE statements |
| `apps/server/src/db/index.ts` | idempotent migration block (3 UPDATEs) |
| `apps/server/tests/*` | migration test |
