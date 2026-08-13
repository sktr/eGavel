# Mock & Dummy UI Cleanup Spec

Date: 2026-08-13
Status: accepted (design approved; implementation is based on this spec)

---

## 1. Background and Problems

The UI contains several mock / dummy elements that do not work or show
fabricated data. These were identified during a full sweep of the app
(`apps/web/app`). Leaving them in place misleads users (fake ratings, fake
join dates, clickable-looking tabs that do nothing, links that 404) and makes
the app look unfinished.

The elements fall into five groups:

1. **Fabricated profile data** on the dashboard (rating, join date, "last
   login" = current time).
2. **Non-functional controls** on the dashboard (tab bar that never switches,
   an Edit Profile button with no action, "View all" links pointing at `#`).
3. **Dead category chrome** — the home page's category pill row (contains
   categories that do not exist in `create/page.tsx`'s `CATEGORIES`) and the
   auctions page's "All Categories" pill with an empty `onClick`.
4. **Placeholder content** — the detail page's "Similar Items" section (four
   hardcoded cards `Item 1..4`).
5. **Dead draft UI** — the create page's "View Drafts" link points at
   `/create/drafts`, which does not exist; the draft save feature
   (`handleSaveDraft`, "Save as Draft" button) was decided to be removed
   entirely.
6. **Unused file** — `apps/web/app/auction-grid.tsx` is not imported anywhere.

## 2. Decisions (agreed during brainstorming)

| Decision | Choice |
|----------|--------|
| Scope | Remove ALL discovered mock/dummy elements |
| Draft feature | Remove entirely (`handleSaveDraft`, "Save as Draft" button, "View Drafts" link) |
| `handleCancel` | Keep (it discards the form, not a draft); reword its confirm if it references drafts |
| Unused file | Delete `auction-grid.tsx` |
| What stays | All real-data sections (Active Bids, My Listings, Won, Watchlist, Watching, stats, BackupSection, RecoveryPhraseDialog) |

## 3. Dashboard (`apps/web/app/dashboard/page.tsx`)

Remove:

| Element | Location | Reason |
|---------|----------|--------|
| "Last login: {new Date()}" header span | ~458-467 | Displays the page-view time as if it were a real last-login timestamp; no such data exists |
| "Rating 4.8 (128 reviews)" | ~522 | Hardcoded fake rating |
| "Joined: 2024/03/12" | ~523 | Hardcoded fake join date |
| Edit Profile button | ~581-595 | No profile-edit feature exists; button does nothing |
| Tab nav (6 tabs) | ~601-624 | `cursor: "default"`, no click handling — the sections below are always shown regardless; the tabs never switch |
| View all (Active Bids) | ~670-675 | `href="#"` dummy |
| View all (My Listings) | ~952-957 | Points at `/create`, not a listings view — misleading as "View all" |
| View all (Watchlist) | ~1152-1157 | `href="#"` dummy |

The header row after removal shows only the "Dashboard" heading. Section
headings ("Active Bids", "My Listings", "Won", "Watchlist") remain, and all
real-data sections keep their current behavior.

## 4. Home page (`apps/web/app/auction-list.tsx`)

Remove the category pill row (lines ~26-41):

```tsx
{/* Categories */}
<div style={{ ... }}>
  {["All", "Art", "Collectibles", "Digital", "Hardware", "Books"].map((cat) => (...))}
</div>
```

Reason: the pills are not clickable (`cursor: "pointer"` but no `onClick`),
and the listed categories (`Digital`, `Hardware`, `Books`) do not exist in
`create/page.tsx`'s `CATEGORIES` (`art, collectibles, watches, bags, jewelry,
wine, cars, furniture, electronics, other`).

## 5. Detail page (`apps/web/app/auctions/[id]/page.tsx`)

Remove the entire "Similar Items" section (lines ~440-527): the heading,
"View more" link, and the grid of four hardcoded cards (`Item {i}`,
`[ Item Image ]`, `— sats`). This is placeholder content with no data source.

## 6. Auctions page (`apps/web/app/auctions/filter-bar.tsx`)

Remove the "All Categories" pill + close button (lines ~36-51). The pill
renders a "close" button with an empty `onClick={() => {}}`; there is no
category filter feature. The sort and status selects stay (they work).

## 7. Create page (`apps/web/app/create/page.tsx`)

Remove:

| Element | Location |
|---------|----------|
| "View Drafts" link + arrow | ~336-345 |
| `handleSaveDraft` function | ~211-233 |
| "Save as Draft" button | ~988-1011 |

Keep `handleCancel` (~236-254): it discards the form. It currently references
drafts — the `confirm()` message is "Discard draft?" (line 238) and the toast
is "Draft discarded" (line 253). Reword both to form-discard copy:

- `confirm("Discard draft?")` → `confirm("Discard changes?")`
- `showToast("Draft discarded", "delete")` → `showToast("Form cleared", "delete")`

Everything else in `handleCancel` (the state reset block) stays.

## 8. Unused file

Delete `apps/web/app/auction-grid.tsx`. Confirm no imports reference it
before deleting (grep for `auction-grid` / `AuctionGrid`).

## 9. Error handling

- No new error paths introduced; all changes are deletions.
- `handleCancel` continues to discard the form and reset state (its reset
  block, including `setShipping("")` added earlier, stays).

## 10. Testing

- **Web**: `apps/web` tests cover `lib/**/*.test.ts` only — no component
  tests exist. Verification is `pnpm --filter @cashu-auction/web run
  typecheck` plus a manual browser pass: dashboard shows no fake data, no
  tabs, no dead "View all" links; home shows no category pills; detail shows
  no "Similar Items"; `/auctions` shows no "All Categories" pill; `/create`
  has no draft UI.
- **Server**: no server changes. Full server suite must still pass
  (regression).
- **Build**: `pnpm --filter @cashu-auction/web run build` must succeed
  (confirms `auction-grid.tsx` deletion left no dangling imports).

## 11. Files touched

| File | Change |
|------|--------|
| `apps/web/app/dashboard/page.tsx` | remove 8 mock elements |
| `apps/web/app/auction-list.tsx` | remove category pill row |
| `apps/web/app/auctions/[id]/page.tsx` | remove Similar Items section |
| `apps/web/app/auctions/filter-bar.tsx` | remove All Categories pill |
| `apps/web/app/create/page.tsx` | remove draft UI + link + function |
| `apps/web/app/auction-grid.tsx` | delete file |
