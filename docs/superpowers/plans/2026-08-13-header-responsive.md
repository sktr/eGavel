# Header Responsive Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the site header responsive: add a DESIGN.md-compliant logo (accent box + gavel icon), trim the nav to a single Auctions link, collapse the account button to an icon on mobile (<640px), and keep everything on one line.

**Architecture:** All changes are in the header component (`apps/web/app/header.tsx`) plus one CSS media query in the global stylesheet (`apps/web/app/layout.tsx`). The mobile collapse is CSS-driven (class + `@media (max-width: 639px)`), so no JS window-size monitoring or SSR concerns.

**Tech Stack:** Next.js 15 (App Router), client component, inline styles, Material Icons (loaded app-wide), global `<style>` block in layout.tsx.

## Global Constraints

- Account button, **desktop (≥640px)**: unchanged — icon + pubkey(12) + balance + caret.
- Account button, **mobile (<640px)**: icon only. The pubkey, balance, and caret spans are hidden via a `header-mobile-hide` class and `@media (max-width: 639px)`.
- Nav links: **only "Auctions"** (keeps its existing `href="/"`). Remove How it Works and Dashboard links.
- Logo: accent `var(--accent)` 28×28 box, `borderRadius: 8`, white `gavel` Material icon (fontSize 16), wordmark "cashu auction" (display font, 20px, 600, `-0.02em`).
- Nav: `flexWrap: "nowrap"`; wordmark may shrink on mobile via the media query (e.g. `font-size: 16px`); everything on one line including 360px viewports (no horizontal scroll).
- The dropdown menu contents (balance, In-app key, Dashboard item, Log out) are UNCHANGED. The connect (logged-out) button is UNCHANGED.
- Web verification: `pnpm --filter @cashu-auction/web run typecheck` + `pnpm --filter @cashu-auction/web run build`; no component tests exist (web vitest covers `lib/**/*.test.ts` only).

---

### Task 1: Header — logo, nav trim, one-line layout

**Files:**
- Modify: `apps/web/app/header.tsx`

**Interfaces:**
- Consumes: existing `identity`, `total`, `loading`, `open`, `theme`, `setTheme` state — unchanged.
- Produces: header with the new logo, single Auctions link, `header-mobile-hide` classes on the three account-button spans, and `flexWrap: "nowrap"` nav.

- [ ] **Step 1: Replace the logo**

In `apps/web/app/header.tsx`, replace the logo `<a href="/">` block (lines 45-50) with:

```tsx
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span className="material-icons" style={{ fontSize: 16, color: "#fff" }}>gavel</span>
          </span>
          <span style={{
            fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600,
            letterSpacing: "-0.02em", color: "var(--fg)", whiteSpace: "nowrap",
          }}>
            cashu auction
          </span>
        </a>
```

- [ ] **Step 2: Trim the nav links**

Replace the links div (lines 51-55) with:

```tsx
        <div style={{ display: "flex", gap: 24, listStyle: "none" }}>
          <a href="/" style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}>Auctions</a>
        </div>
```

- [ ] **Step 3: One-line nav**

Change the nav style (lines 41-44) from `flexWrap: "wrap"` to `flexWrap: "nowrap"`:

```tsx
      <nav style={{
        display: "flex", alignItems: "center", gap: 24,
        padding: "16px 0", borderBottom: "1px solid var(--border)", flexWrap: "nowrap"
      }}>
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/header.tsx
git commit -m "feat: add gavel logo, trim nav to Auctions, one-line header"
```

---

### Task 2: Account button responsive — mobile icon-only via CSS class

**Files:**
- Modify: `apps/web/app/header.tsx`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Consumes: the account button structure from Task 1 (unchanged markup otherwise).
- Produces: on <640px, the pubkey/balance/caret spans inside the account button are hidden; on ≥640px they render as before.

- [ ] **Step 1: Add `header-mobile-hide` classes**

In `apps/web/app/header.tsx`, add `className="header-mobile-hide"` to the three account-button spans:

(a) The pubkey span (currently ~line 90):

```tsx
                <span className="header-mobile-hide" style={{ fontFamily: "var(--font-mono)" }}>
                  {identity.pubkey.slice(0, 12)}…
                </span>
```

(b) The balance wrapper (currently `{!loading && (<span ...>)}` at ~line 93). Add the class to the outer span:

```tsx
                {!loading && (
                  <span className="header-mobile-hide" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 600 }}>
                    {total.toLocaleString()}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}> sats</span>
                  </span>
                )}
```

(c) The caret span (currently ~line 99). Add the class alongside the existing `material-icons` class (only ONE `className` attribute — do not duplicate it):

```tsx
                <span className="header-mobile-hide material-icons" style={{ fontSize: 14, color: "var(--muted)" }}>
                  {open ? "expand_less" : "expand_more"}
                </span>
```

- [ ] **Step 2: Add the mobile media query to the global stylesheet**

In `apps/web/app/layout.tsx`, inside the global `<style>` block (before the closing `@media(prefers-reduced-motion:reduce){...}` at line 131, or after it — either is fine), add:

```css
          @media (max-width: 639px) {
            .header-mobile-hide { display: none !important; }
          }
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors (confirms no duplicate `className` attribute was left in the caret span).

- [ ] **Step 4: Build check**

Run: `pnpm --filter @cashu-auction/web run build`
Expected: production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/header.tsx apps/web/app/layout.tsx
git commit -m "feat: collapse account button to icon on mobile via media query"
```

---

### Task 3: Full verification + mobile manual pass

**Files:**
- No code changes.

- [ ] **Step 1: Run the full test suites**

Run: `pnpm test && pnpm --filter @cashu-auction/web run test`
Expected: server 112/112 PASS, web 25/25 PASS.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @cashu-auction/web run typecheck && pnpm --filter @cashu-auction/web run build`
Expected: clean.

- [ ] **Step 3: Manual desktop pass**

With the dev server or the deployed app at ≥640px width:
- Logo shows the gavel box + "cashu auction".
- Nav shows only Auctions.
- Account button shows icon + pubkey + balance + caret (unchanged).
- Dropdown still opens with Balance / In-app key / Dashboard / Log out.

- [ ] **Step 4: Manual mobile pass**

At 360px viewport width:
- Header is ONE line: logo · Auctions · theme toggle · avatar — no wrap, no horizontal scroll.
- Account button is icon-only (circular person); pubkey/balance/caret hidden.
- Tapping the avatar opens the dropdown (Dashboard / pubkey / balance / log out reachable).

- [ ] **Step 5: Commit any fixups**

```bash
git status
git add -A
git commit -m "fix: final verification fixes"
```

(Only commit if there are actual changes from the verification steps.)
