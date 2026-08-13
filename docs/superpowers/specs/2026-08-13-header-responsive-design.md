# Header Responsive Redesign Spec

Date: 2026-08-13
Status: accepted (design approved; implementation is based on this spec)

---

## 1. Background and Problems

The header (`apps/web/app/header.tsx`) currently renders as:

```
[cashu auction]  [Auctions] [How it Works] [Dashboard]  ...  [🌓] [👤 10809b80... 0 sats ▾]
```

Problems on mobile:

1. **The account button shows the full pubkey + balance** on all screen
   sizes. On a narrow phone this is too wide and wraps the nav onto a second
   line.
2. **Redundant navigation links**: "How it Works" already lives in the
   footer, and "Dashboard" is already reachable via the account dropdown
   (the account button itself opens a menu containing a Dashboard item).
   Both take horizontal space for no added reachability.
3. **No logo**: the design system (`DESIGN.md` §Navigation) specifies "Logo:
   display font, accent icon box (28px, rounded 8px)" but the header only
   shows the wordmark text.
4. The nav uses `flexWrap: "wrap"`, so on narrow screens the header
   reflows onto two lines instead of staying on one.

## 2. Decisions (agreed during brainstorming)

| Decision | Choice |
|----------|--------|
| Account button, desktop (≥640px) | Keep as-is: icon + pubkey(12) + balance + caret |
| Account button, mobile (<640px) | Icon only (circular person button) |
| Nav links | Keep only "Auctions"; remove "How it Works" and "Dashboard" |
| Logo | Accent-colored 28px rounded-8 box with a white `gavel` Material icon + "cashu auction" wordmark |
| Mobile layout | All elements on ONE line: logo · Auctions · spacer · theme toggle · avatar |
| Responsive mechanism | CSS media query (`@media (max-width: 639px)`), not JS |

## 3. Logo (`apps/web/app/header.tsx`, ~lines 45-50)

Replace the bare text link with the DESIGN.md-compliant logo:

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

## 4. Nav links (`apps/web/app/header.tsx`, ~lines 51-55)

Keep only the Auctions link. Remove the How it Works and Dashboard links:

```tsx
<div style={{ display: "flex", gap: 24, listStyle: "none" }}>
  <a href="/" style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}>Auctions</a>
</div>
```

(Note: Auctions currently points at `/` — keep its existing href.)

## 5. Account button responsive (`apps/web/app/header.tsx`, ~lines 74-102)

Desktop stays exactly as-is. On mobile (<640px) the pubkey span, balance
span, and caret span are hidden so the button becomes a circular person
icon.

Add a class or use inline `style` with a media-query-driven CSS rule. The
cleanest approach given the file's inline-style convention:

- Add a `data-mobile-hide` attribute (or a stable class) to the three spans
  (pubkey, balance, caret) and the inner text of the balance.
- Add the media query to the global stylesheet in `apps/web/app/layout.tsx`
  (where the existing `@media` rules live, if any) or a small `<style>` in
  the header:

```css
@media (max-width: 639px) {
  .header-mobile-hide { display: none !important; }
}
```

and on the button itself reduce padding to `6px 8px` (or keep and let the
icon be centered — the button's `borderRadius: 100` makes it a pill; with
only the icon it reads as a circular avatar). The connect (logged-out)
button is unchanged.

Exact implementation detail (choose one, keep consistent):
- Option A: `className="header-mobile-hide"` on the three spans + the CSS
  rule above. Simple, idiomatic.
- Option B: a `style` object with `["@media (max-width: 639px)"]` — not
  supported by React's inline style. So use Option A (class) or a `<style>`
  block in the header component.

The mobile button should render as: `(person icon)` inside the pill — the
avatar affordance that opens the account dropdown (which contains
Dashboard, pubkey copy, balance, log out).

## 6. One-line layout (`apps/web/app/header.tsx`, ~lines 41-44)

Change the nav to `flexWrap: "nowrap"` (or remove the `wrap`) and tighten
gaps so everything fits on one line:

```tsx
<nav style={{
  display: "flex", alignItems: "center", gap: 24,
  padding: "16px 0", borderBottom: "1px solid var(--border)", flexWrap: "nowrap",
}}>
```

On mobile:
- The wordmark "cashu auction" may shrink (`fontSize` ~16-18px) to fit.
- Reduce the nav `gap` (e.g. `gap: 16` on mobile via media query, or a
  smaller fixed gap that still looks right on desktop).
- The `marginLeft: "auto"` on the right cluster keeps the theme toggle +
  avatar pinned right.
- Keep the container padding at `0 24px` on desktop; on mobile the layout
  is verified to fit a 360px viewport without overflow.

## 7. Scope

- Touch `apps/web/app/header.tsx` (logo, nav, account button, nav layout)
  and `apps/web/app/layout.tsx` (media-query CSS) if the global stylesheet
  is the chosen home for the rule.
- No changes to the dropdown menu contents (balance, In-app key, Dashboard
  item, Log out stay).
- No changes to the footer, other pages, or server.

## 8. Testing

- **Web**: no component test harness (`lib/**/*.test.ts` only). Verify with
  `pnpm --filter @cashu-auction/web run typecheck` + `pnpm --filter
  @cashu-auction/web run build` + manual browser pass:
  - Desktop ≥640px: header unchanged except the logo box and the removed
    How it Works / Dashboard links; account button shows icon + pubkey +
    balance + caret.
  - Mobile <640px (e.g. 360px wide): one line — logo · Auctions · toggle ·
    avatar; no horizontal scroll; account button is icon-only; dropdown
    still opens with Dashboard / pubkey / balance / log out.
- **Server**: no changes. Full server suite must still pass.

## 9. Files touched

| File | Change |
|------|--------|
| `apps/web/app/header.tsx` | logo, nav links, account-button responsive, one-line layout |
| `apps/web/app/layout.tsx` | media-query CSS rule (if the global stylesheet is used) |
