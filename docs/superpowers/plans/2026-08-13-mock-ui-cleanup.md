# Mock & Dummy UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all mock/dummy UI elements from the web app — fake dashboard profile data, non-functional controls, dead category chrome, placeholder content, and the unused draft feature — leaving only real-data sections.

**Architecture:** Pure deletions across five page files plus one file removal. No new code, no state changes, no API changes. Each file's mock elements are removed while real-data sections (stats, Active Bids, My Listings, Won, Watchlist, Watching, BackupSection) are untouched.

**Tech Stack:** Next.js 15 (App Router), client components. No tests beyond typecheck + build (web vitest covers `lib/**/*.test.ts` only; no component test harness).

## Global Constraints

- Remove ONLY the elements listed in the spec. Do not restructure or "improve" real-data sections.
- The dashboard header row after removal shows only the "Dashboard" heading.
- Section headings ("Active Bids", "My Listings", "Won", "Watchlist") and their real-data content stay.
- `handleCancel` keeps its state-reset block; only its two strings change:
  - `confirm("Discard draft?")` → `confirm("Discard changes?")`
  - `showToast("Draft discarded", "delete")` → `showToast("Form cleared", "delete")`
- `auction-grid.tsx` deletion must not leave dangling imports (grep before deleting).
- Verification: `pnpm --filter @cashu-auction/web run typecheck` clean, `pnpm --filter @cashu-auction/web run build` succeeds, full server suite still passes.

---

### Task 1: Dashboard — remove fake profile data and dead controls

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: existing state/vars (`activeBids`, `wonAuctions`, `activeListings`, `auctions`, `ids`, `identity`) — unchanged.
- Produces: dashboard with no Last-login span, no Rating/Joined spans, no Edit Profile button, no tab nav, no View all links.

- [ ] **Step 1: Remove the "Last login" span**

In `apps/web/app/dashboard/page.tsx`, replace the header block (currently the `<h1>Dashboard</h1>` + `<span>Last login: ...</span>` inside a flex div, ~lines 440-468) so only the heading remains. The `<div style={{ display: "flex", justifyContent: "space-between", ... }}>` wrapper can stay (it just wraps the h1 now) — but if the wrapper only contained h1 + the span, simplify it to keep just the h1. Find the exact wrapper by reading lines 430-470 first. Result:

```tsx
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(22px, 2.5vw, 28px)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Dashboard
        </h1>
      </div>
```

(Match the existing wrapper style — if the original wrapper has `display: flex` etc., keep those properties if they don't look wrong with a single child; simplest is to keep the wrapper's existing style object.)

- [ ] **Step 2: Remove Rating and Joined spans**

In the Profile Card info block (currently ~lines 512-524), remove the two `<span>` elements "Rating 4.8 (128 reviews)" and "Joined: 2024/03/12" inside the `display: flex` row. The row div itself can stay (it will be empty or removed). If the row div becomes empty after removal, remove the div too.

- [ ] **Step 3: Remove the Edit Profile button**

Remove the `<button>Edit Profile</button>` block (~lines 581-595). If the profile card's outer flex row becomes imbalanced (the button was a flex sibling), just remove the button element; the card layout remains acceptable.

- [ ] **Step 4: Remove the tab navigation**

Remove the entire `{/* ===== Tab Navigation ===== */}` block (~lines 601-624) including the map over `["Bidding", "Won", "Listed", "Watchlist", "Bid History", "Settings"]`.

- [ ] **Step 5: Remove the three "View all" links**

For each of the three section headers (Active Bids ~line 671, My Listings ~line 953, Watchlist ~line 1153), remove only the `<a>View all ...</a>` element, keeping the `<h2>` heading and the header wrapper div.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

Grep for leftovers:

```bash
grep -n "Last login\|Rating 4.8\|Joined:\|Edit Profile\|Tab Navigation\|Bid History\|View all\|href=\"#\"" apps/web/app/dashboard/page.tsx
```

Expected: no matches.

Manual browser check (if backend available): dashboard shows the profile card (pubkey + real stats), then Watching / Active Bids / My Listings / Won / Watchlist sections — no tabs, no fake data, no dead links.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/dashboard/page.tsx
git commit -m "feat: remove fake profile data and dead controls from dashboard"
```

---

### Task 2: Home + auctions + detail — remove dead category chrome and placeholder content

**Files:**
- Modify: `apps/web/app/auction-list.tsx`
- Modify: `apps/web/app/auctions/filter-bar.tsx`
- Modify: `apps/web/app/auctions/[id]/page.tsx`

**Interfaces:**
- Consumes: none (pure deletions).
- Produces: home page without the category pill row; `/auctions` filter bar without the "All Categories" pill; detail page without the Similar Items section.

- [ ] **Step 1: Remove the category pill row from the home page**

In `apps/web/app/auction-list.tsx`, remove the entire `{/* Categories */}` block (lines ~26-41) — the `<div>` containing the `["All", "Art", "Collectibles", "Digital", "Hardware", "Books"].map(...)` pills. Also remove the `borderBottom: "1px solid var(--border)"` divider wrapper if it only existed for that row (read the surrounding structure first; the wrapper div with `display: flex ... paddingBottom: 40, borderBottom ... marginBottom: 40` is the block to remove entirely).

- [ ] **Step 2: Remove the "All Categories" pill from the filter bar**

In `apps/web/app/auctions/filter-bar.tsx`, remove the `{/* Active category pill */}` block (~lines 36-51) — the `<span>` with the "All Categories" text and the close `<button onClick={() => {}}>`. The result-count span and the two selects (sort, status) stay.

- [ ] **Step 3: Remove the Similar Items section from the detail page**

In `apps/web/app/auctions/[id]/page.tsx`, remove the entire `{/* ===== BELOW THE GRID: Similar Items (placeholder) ===== */}` block (lines ~440-527) — from that comment through the closing `</div>` of the section (just before the final two closing `</div>` of the page grid). Read lines 435-531 first to identify the exact boundaries: the section is a `<div style={{ gridColumn: "1 / -1" }}>` sibling of the Checkout section and the Details Table.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

Grep for leftovers:

```bash
grep -n "Digital\|Hardware\|Books\|All Categories\|Similar Items\|Item {i}\|View more" apps/web/app/auction-list.tsx apps/web/app/auctions/filter-bar.tsx "apps/web/app/auctions/[id]/page.tsx"
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/auction-list.tsx apps/web/app/auctions/filter-bar.tsx "apps/web/app/auctions/[id]/page.tsx"
git commit -m "feat: remove dead category chrome and placeholder content from list/detail pages"
```

---

### Task 3: Create page — remove draft feature; reword handleCancel

**Files:**
- Modify: `apps/web/app/create/page.tsx`

**Interfaces:**
- Consumes: `handleCancel` (kept, reworded); `handleOpenModal` / `handleConfirm` unchanged.
- Produces: create page without "View Drafts" link, `handleSaveDraft` function, or "Save as Draft" button.

- [ ] **Step 1: Remove the "View Drafts" link**

In `apps/web/app/create/page.tsx`, remove the `<a href="/create/drafts">View Drafts ...</a>` element (~lines 336-345) from the page header row. The `<h1>Create Listing</h1>` stays.

- [ ] **Step 2: Remove `handleSaveDraft`**

Remove the entire `function handleSaveDraft() { ... }` (~lines 211-233).

- [ ] **Step 3: Remove the "Save as Draft" button**

Remove the `<button type="button" onClick={handleSaveDraft} ...>Save as Draft</button>` element (~lines 988-1011). The Publish button and Cancel button stay.

- [ ] **Step 4: Reword `handleCancel`**

In `handleCancel` (~lines 236-254), change the two strings:

```tsx
      if (!confirm("Discard changes?")) return;
```

and

```tsx
    showToast("Form cleared", "delete");
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors (confirms no dangling `handleSaveDraft` references).

Grep for leftovers:

```bash
grep -n "handleSaveDraft\|Save as Draft\|View Drafts\|/create/drafts\|Discard draft\|Draft saved\|Draft discarded\|auction_drafts" apps/web/app/create/page.tsx
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/create/page.tsx
git commit -m "feat: remove draft feature from create page; reword cancel to form-discard"
```

---

### Task 4: Delete unused `auction-grid.tsx`

**Files:**
- Delete: `apps/web/app/auction-grid.tsx`

**Interfaces:**
- Produces: the file no longer exists; nothing references it.

- [ ] **Step 1: Confirm no imports reference it**

Run: `grep -rn "auction-grid\|AuctionGrid" apps/web --include="*.tsx" --include="*.ts" | grep -v node_modules`
Expected: only the file itself matches (or nothing). If any other file imports it, STOP and report.

- [ ] **Step 2: Delete the file**

```bash
git rm apps/web/app/auction-grid.tsx
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cashu-auction/web run typecheck`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete unused auction-grid component"
```

---

### Task 5: Full verification

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
Expected: production build succeeds (confirms the `auction-grid.tsx` deletion left no dangling imports).

- [ ] **Step 4: Manual browser pass (if backend available)**

1. `/` — no category pills; hero + auction sections only.
2. `/dashboard` — profile card with real stats only; no fake data, no tabs, no dead links.
3. `/auctions` — filter bar has result count + sort/status selects only; no "All Categories" pill.
4. `/auctions/{id}` — no Similar Items section.
5. `/create` — no draft UI; Cancel says "Discard changes?" and shows "Form cleared".

- [ ] **Step 5: Commit any fixups**

```bash
git status
git add -A
git commit -m "fix: final verification fixes"
```

(Only commit if there are actual changes from the verification steps.)
