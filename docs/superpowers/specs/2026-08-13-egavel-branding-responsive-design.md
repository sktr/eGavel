# eGavel Branding + Full Responsive Redesign Spec

Date: 2026-08-13
Status: accepted (design approved; implementation is based on this spec)

---

## 1. Background and Problems

Two related concerns were raised:

1. **Brand name.** "cashu auction" is an unoriginal name — it describes the
   tech stack (Cashu protocol) and the function (auction) rather than acting
   as a brand. After discussion (gavel/hammer + eCash/sats candidates), the
   name **eGavel** was chosen: short, gavel (auction hammer) + "e" echoing
   eCash/electronic. The deployed URL is `cashu-auction.vercel.app`; the
   provisional next URL is `egavel.vercel.app` (final `.com` TBD — out of
   scope here, but the name and URL should align).

2. **Responsive design is incomplete.** The create page uses a fixed
   `1fr 360px` two-column grid so the sidebar preview stays a fixed 360px on
   mobile, squashing the form and causing horizontal scroll (measured: 635px
   scrollWidth at a 360px viewport). The top hero (`1fr 1fr`), the detail
   page (`1fr 1fr`), and the dashboard's `56px 1fr auto` rows are also fixed
   columns that do not collapse on mobile. Pages using
   `repeat(auto-fill, minmax(...))` (auction grids) already adapt and need no
   change.

## 2. Decisions (agreed during brainstorming)

| Decision | Choice |
|----------|--------|
| Brand name | **eGavel** |
| Header logo | gavel icon ONLY (no wordmark, no Auctions link) |
| Header layout (all breakpoints) | `[gavel icon → /]  ......  [theme toggle] [avatar + sats ▾]` |
| Where "eGavel" appears | `<title>`, footer, how-it-works heading only — NOT in the header |
| Responsive mechanism | CSS classes + `@media (max-width: 639px)` in the global style block |
| create page | form grid `1fr 360px` → `1fr`; both `1fr 1fr` grids → `1fr` on mobile |
| Top hero | `1fr 1fr` → `1fr` on mobile |
| Detail page | `1fr 1fr` → `1fr` on mobile (gallery stays first — source order) |
| Dashboard rows | `56px 1fr auto` → `56px 1fr` with the last cell wrapping to a second right-aligned row on mobile |
| Account button mobile | avatar + sats visible; pubkey/balance-detail hidden (existing `header-mobile-hide` behavior for the pubkey; the avatar + sats stay) |

Note on the account button: the previous header spec hid the balance on
mobile. This spec reverses that for the **compact sats readout** — the avatar
pill keeps "0 sats" visible on mobile (pubkey stays hidden). The dropdown
(balance detail, In-app key, Dashboard, Log out) is unchanged.

## 3. Branding changes

### 3.1 `apps/web/app/layout.tsx`

- `<title>`: `"Cashu Auction"` → `"eGavel"`
- Footer: `"© 2025 Cashu Auction"` → `"© 2025 eGavel"`

### 3.2 `apps/web/app/how-it-works/page.tsx`

- Heading: `"How Cashu Auction Works"` → `"How eGavel Works"`

### 3.3 `apps/web/app/header.tsx`

- The logo `<a href="/">` renders ONLY the gavel icon box (28×28, accent,
  radius 8, white `gavel` icon). Remove the wordmark span and the Auctions
  nav link. The nav keeps `flexWrap: "nowrap"` and the existing clamp gaps.
- The account button keeps the avatar icon + sats readout on all
  breakpoints; the pubkey span keeps `header-mobile-hide` (hidden <640px).
  The balance `header-mobile-hide` span and caret are removed from hiding —
  they stay visible on mobile (avatar + sats + caret).
  - Current `header-mobile-hide` class locations (from the previous header
    task, commit `cc041a2`): line 96 pubkey (KEEP the class), line 100
    balance wrapper (REMOVE the class), line 105 caret (REMOVE the class —
    revert to `className="material-icons"`).
  - If the caret/sats make the pill too wide at 360px, the `@media` rule may
    reduce the button padding (e.g. `6px 8px`). Verify at 360px (no
    horizontal scroll).

## 4. Responsive changes

### 4.1 New CSS classes in the global style block (`apps/web/app/layout.tsx`)

```css
@media (max-width: 639px) {
  .resp-grid-2col { grid-template-columns: 1fr !important; }
  .resp-grid-form { grid-template-columns: 1fr !important; }
  .resp-grid-row { grid-template-columns: 56px 1fr !important; }
  .resp-grid-row > :last-child { grid-column: 1 / -1; text-align: right !important; }
}
```

### 4.2 `apps/web/app/create/page.tsx`

- Form grid (`gridTemplateColumns: "1fr 360px"`, ~line 316): add
  `className="resp-grid-form"`.
- Condition/shipping grid (`gridTemplateColumns: "1fr 1fr"`, ~line 660): add
  `className="resp-grid-2col"`.
  - Note: this is actually the **Pricing** grid (start price / buy-now in
    two columns); it is the only `1fr 1fr` grid with `gap: 16`, so the
    target is unambiguous. On mobile the two price inputs stack.
- Confirmation modal grid (`gridTemplateColumns: "1fr 1fr"`, ~line 1248):
  add `className="resp-grid-2col"`.

### 4.3 `apps/web/app/page.tsx`

- Hero grid (`gridTemplateColumns: featured ? "1fr 1fr" : "1fr"`, ~line 29):
  add `className="resp-grid-2col"` (the `!important` in the media query wins
  over the inline conditional, so `1fr` applies on mobile regardless of
  `featured`).

### 4.4 `apps/web/app/auctions/[id]/page.tsx`

- Detail grid (`gridTemplateColumns: "1fr 1fr"`, ~line 58): add
  `className="resp-grid-2col"`. Source order keeps the Gallery first.

### 4.5 `apps/web/app/dashboard/page.tsx`

- Three `gridTemplateColumns: "56px 1fr auto"` rows (~lines 629, 759, 903):
  add `className="resp-grid-row"` to each row's `style` object. The
  `.resp-grid-row > :last-child` rule wraps the right-aligned status/price
  cell to a full-width second row on mobile.

## 5. Scope

- No changes to the dropdown menu, footer content beyond the name, server,
  or data.
- The `repeat(auto-fill, minmax(...))` grids (home/auctions card grids) are
  already responsive — untouched.
- `how-it-works` heading text only.

## 6. Testing

- **Web**: no component test harness. Verify with `pnpm --filter
  @cashu-auction/web run typecheck` + `pnpm --filter @cashu-auction/web run
  build` + manual browser pass at 360px and ≥640px:
  - 360px: create page has NO horizontal scroll (scrollWidth == 360); the
    preview renders below the form; detail grid is single-column with the
    gallery first; dashboard rows wrap the price to a second line; hero is
    single-column; header shows `[gavel] [toggle] [avatar 0 sats ▾]`.
  - ≥640px: all layouts unchanged from before (except the header logo/Auctions
    link removal and the brand-name text).
  - `<title>` shows "eGavel"; footer shows "© 2025 eGavel".
- **Server**: no changes. Full server suite must still pass.

## 7. Files touched

| File | Change |
|------|--------|
| `apps/web/app/layout.tsx` | title, footer name, media-query CSS classes |
| `apps/web/app/header.tsx` | logo icon-only, remove Auctions link, keep avatar+sats visible on mobile |
| `apps/web/app/how-it-works/page.tsx` | heading name |
| `apps/web/app/create/page.tsx` | 3 grid classNames |
| `apps/web/app/page.tsx` | hero grid className |
| `apps/web/app/auctions/[id]/page.tsx` | detail grid className |
| `apps/web/app/dashboard/page.tsx` | 3 row classNames |
