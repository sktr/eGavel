# eGavel Branding + Full Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the app to "eGavel" (title, footer, how-it-works heading; the header logo becomes a gavel icon only) and make every fixed-column layout collapse to one column (or two rows) on mobile via CSS media queries.

**Architecture:** Branding is text/markup changes in `layout.tsx`, `how-it-works/page.tsx`, and `header.tsx`. Responsive is CSS-class-based: each fixed grid gets a `resp-grid-*` className, and `@media (max-width: 639px)` rules in the global style block override the inline `gridTemplateColumns` with `!important`. No JS window monitoring.

**Tech Stack:** Next.js 15 (App Router), inline styles, Material Icons, global `<style>` block in `layout.tsx`.

## Global Constraints

- Brand name "eGavel" appears ONLY in: `<title>`, footer (`© 2025 eGavel`), how-it-works heading. The header logo is the gavel icon ONLY — no wordmark, no "eGavel" text.
- Header layout (all breakpoints): `[gavel icon → /]  ......  [theme toggle] [avatar + sats ▾]`. The Auctions nav link is REMOVED.
- Account button: pubkey span KEEPS `header-mobile-hide` (hidden <640px). The balance wrapper span and caret span LOSE `header-mobile-hide` (visible on all breakpoints: avatar + sats + caret).
- Responsive: `@media (max-width: 639px)` with `!important` overrides (must beat inline styles).
- Media query rules (exact):
  ```css
  @media (max-width: 639px) {
    .resp-grid-2col { grid-template-columns: 1fr !important; }
    .resp-grid-form { grid-template-columns: 1fr !important; }
    .resp-grid-row { grid-template-columns: 56px 1fr !important; }
    .resp-grid-row > :last-child { grid-column: 1 / -1; text-align: right !important; }
  }
  ```
- create page: form grid `1fr 360px` → `resp-grid-form`; Pricing grid `1fr 1fr` → `resp-grid-2col`; modal grid `1fr 1fr` → `resp-grid-2col`.
- Top hero: `resp-grid-2col` (mobile `1fr` regardless of `featured`).
- Detail page: `resp-grid-2col` (gallery stays first via source order).
- Dashboard: 3 rows `56px 1fr auto` → `resp-grid-row`.
- `repeat(auto-fill, minmax(...))` grids are already responsive — untouched.
- Verification: `pnpm --filter @cashu-auction/web run typecheck` + `pnpm --filter @cashu-auction/web run build`; server suite must still pass (112/112).

---

### Task 1: Branding — eGavel in title, footer, how-it-works

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/how-it-works/page.tsx`

**Interfaces:**
- Produces: `<title>eGavel</title>`, footer `© 2025 eGavel`, how-it-works heading "How eGavel Works". No other "Cashu Auction" strings remain in these two files.

- [ ] **Step 1: Update the title**

In `apps/web/app/layout.tsx`, line 7:

```tsx
  title: "eGavel",
```

- [ ] **Step 2: Update the footer**

In `apps/web/app/layout.tsx`, line 152:

```tsx
              <span>© 2025 eGavel</span>
```

- [ ] **Step 3: Update the how-it-works heading**

In `apps/web/app/how-it-works/page.tsx`, line 12:

```tsx
        How eGavel Works
```

- [ ] **Step 4: Verify no leftover "Cashu Auction" in the touched files**

Run: `grep -n "Cashu Auction" apps/web/app/layout.tsx apps/web/app/how-it-works/page.tsx`
Expected: no matches.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/layout.tsx apps/web/app/how-it-works/page.tsx
git commit -m "feat: rebrand to eGavel (title, footer, how-it-works)"
```

---

### Task 2: Header — gavel icon only, remove Auctions link, keep avatar+sats on mobile

**Files:**
- Modify: `apps/web/app/header.tsx`

**Interfaces:**
- Consumes: existing logo markup (Task 1 of the previous header plan added the gavel box + wordmark; this task removes the wordmark and the Auctions link).
- Produces: header = `[gavel icon → /]  ......  [theme toggle] [avatar + sats ▾]`; account button shows avatar + sats + caret on all breakpoints; pubkey hidden on mobile.

- [ ] **Step 1: Remove the wordmark and the Auctions link**

In `apps/web/app/header.tsx`, replace the logo block (the `<a href="/">` with the box + wordmark spans, and the following Auctions link div, ~lines 45-61) with:

```tsx
        <a
          href="/"
          aria-label="eGavel home"
          style={{ display: "flex", alignItems: "center", textDecoration: "none" }}
        >
          <span style={{
            width: 28, height: 28, borderRadius: 8, background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span className="material-icons" style={{ fontSize: 16, color: "#fff" }}>gavel</span>
          </span>
        </a>
```

(Remove the wordmark `<span>` and the `<div>` containing the Auctions link entirely.)

- [ ] **Step 2: Make the balance and caret visible on mobile**

In the account button:
- The balance wrapper span (currently `className="header-mobile-hide"` at ~line 100): change to no class (remove `header-mobile-hide`).
- The caret span (currently `className="header-mobile-hide material-icons"` at ~line 105): change to `className="material-icons"` (remove `header-mobile-hide`).
- The pubkey span (~line 96) KEEPS `className="header-mobile-hide"`.

Verify the final state:

```tsx
                <span className="header-mobile-hide" style={{ fontFamily: "var(--font-mono)" }}>
                  {identity.pubkey.slice(0, 12)}…
                </span>
                {!loading && (
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 600 }}>
                    {total.toLocaleString()}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}> sats</span>
                  </span>
                )}
                <span className="material-icons" style={{ fontSize: 14, color: "var(--muted)" }}>
                  {open ? "expand_less" : "expand_more"}
                </span>
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

Grep for leftovers:

```bash
grep -n "cashu auction\|Auctions\|How it Works\|Dashboard" apps/web/app/header.tsx
```

Expected: no matches in the nav area (the dropdown's Dashboard menuitem at ~line 187 is fine and SHOULD remain — the grep will match it; that's expected).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/header.tsx
git commit -m "feat: header logo is gavel icon only; keep avatar+sats on mobile"
```

---

### Task 3: Responsive CSS classes + apply to create / hero / detail / dashboard

**Files:**
- Modify: `apps/web/app/layout.tsx` (media query)
- Modify: `apps/web/app/create/page.tsx` (3 classNames)
- Modify: `apps/web/app/page.tsx` (hero className)
- Modify: `apps/web/app/auctions/[id]/page.tsx` (detail className)
- Modify: `apps/web/app/dashboard/page.tsx` (3 row classNames)

**Interfaces:**
- Consumes: the grid sections identified in the spec.
- Produces: on <640px, all fixed grids collapse per the media query; ≥640px unchanged.

- [ ] **Step 1: Add the media query to the global style block**

In `apps/web/app/layout.tsx`, inside the global `<style>` block (near the existing `@media(prefers-reduced-motion:reduce)` rule at ~line 131), add:

```css
          @media (max-width: 639px) {
            .resp-grid-2col { grid-template-columns: 1fr !important; }
            .resp-grid-form { grid-template-columns: 1fr !important; }
            .resp-grid-row { grid-template-columns: 56px 1fr !important; }
            .resp-grid-row > :last-child { grid-column: 1 / -1; text-align: right !important; }
          }
```

- [ ] **Step 2: Apply the classNames**

(a) `apps/web/app/create/page.tsx`:
- Form grid (the `div` with `gridTemplateColumns: "1fr 360px"`, ~line 313): add `className="resp-grid-form"` to that div.
- Pricing grid (`gridTemplateColumns: "1fr 1fr"` with `gap: 16`, ~line 658): add `className="resp-grid-2col"`.
- Confirmation modal grid (`gridTemplateColumns: "1fr 1fr"` with `gap: 12, marginTop: 20`, ~line 1247): add `className="resp-grid-2col"`.

(b) `apps/web/app/page.tsx` — the hero `<section>` (~line 28): add `className="resp-grid-2col"`.

(c) `apps/web/app/auctions/[id]/page.tsx` — the detail grid `div` (~line 56): add `className="resp-grid-2col"`.

(d) `apps/web/app/dashboard/page.tsx` — three `rowStyle` objects (each with `gridTemplateColumns: "56px 1fr auto"`, ~lines 629, 759, 903): add `className: "resp-grid-row"` to each `rowStyle` object (they are style objects passed to a `div` via `style={rowStyle}` — add the className to the element that uses the style, OR add `className` inside the style object is invalid; check how each row is rendered and add `className="resp-grid-row"` to the row's JSX element).

Note: the three rows are rendered via `rowStyle` constants; find each `<div style={rowStyle}>` (or equivalent) and add `className="resp-grid-row"` to the JSX element. If a row is created in a helper, apply the className at the render site.

- [ ] **Step 3: Verify typecheck + build**

Run: `pnpm --filter @cashu-auction/web run typecheck && pnpm --filter @cashu-auction/web run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/layout.tsx apps/web/app/create/page.tsx apps/web/app/page.tsx "apps/web/app/auctions/[id]/page.tsx" apps/web/app/dashboard/page.tsx
git commit -m "feat: collapse fixed grids to single column on mobile"
```

---

### Task 4: Full verification + responsive manual pass

**Files:**
- No code changes.

- [ ] **Step 1: Run the full test suites**

Run: `pnpm test && pnpm --filter @cashu-auction/web run test`
Expected: server 112/112 PASS, web 25/25 PASS.

- [ ] **Step 2: Manual desktop pass (≥640px)**

With the dev server or deployed app:
- Header: `[gavel]  ......  [toggle] [avatar pubkey… 0 sats ▾]` — logo is icon only, no Auctions link, no wordmark.
- `<title>` shows "eGavel"; footer shows "© 2025 eGavel"; how-it-works heading "How eGavel Works".
- create / detail / dashboard layouts unchanged from before.

- [ ] **Step 3: Manual mobile pass (360px)**

- Header: `[gavel] [toggle] [avatar 0 sats ▾]` — one line, no horizontal scroll, avatar+sats+caret visible, pubkey hidden.
- create: NO horizontal scroll (scrollWidth == 360); preview below the form.
- hero: single column.
- detail: single column, gallery first.
- dashboard: rows wrap the price to a second right-aligned line.

- [ ] **Step 4: Commit any fixups**

```bash
git status
git add -A
git commit -m "fix: final verification fixes"
```

(Only commit if there are actual changes from the verification steps.)
