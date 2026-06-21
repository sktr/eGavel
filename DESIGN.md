# Cashu Auction Design System

## Brand

Cashu Auction is a peer-to-peer auction platform built on Cashu e-cash.

**Core values:**
- Trustless by design — escrow handled by protocol
- Instant settlement — Cashu token finality
- Non-custodial — the server can never move funds alone (2-of-3 P2PK)
- Human-first — warm, accessible, approachable

## Design Principles

1. **Clarity over density** — Key data at a glance, not buried
2. **Trust through transparency** — Show state, provenance, escrow
3. **Human-first technology** — Warm palette, clear copy
4. **Restraint** — One accent, minimal decoration

## Color System

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `oklch(98% 0.004 240)` | Page background |
| `--surface` | `oklch(100% 0 0)` | Component background |
| `--fg` | `oklch(20% 0.02 240)` | Primary text |
| `--muted` | `oklch(50% 0.018 240)` | Secondary text |
| `--border` | `oklch(90% 0.006 240)` | Borders |
| `--accent` | `oklch(56% 0.12 170)` | Green-teal action |
| `--accent-soft` | `oklch(90% 0.04 170)` | Accent tint |
| `--danger` | `oklch(55% 0.18 30)` | Destructive |
| `--success` | `oklch(55% 0.14 145)` | Positive |
| `--amber` | `oklch(70% 0.16 85)` | Warning |
| `--glow` | `oklch(56% 0.12 170 / 0.08)` | Accent glow |

## Typography

- **Display:** Söhne, Avenir Next, system-ui, sans-serif — headings, 700
- **Body:** System font stack — UI, body copy
- **Mono:** JetBrains Mono, SF Mono — prices, codes

| Level | Size | Weight | Use |
|-------|------|--------|-----|
| h1 | `clamp(32px,5vw,48px)` | 700 | Page heroes |
| h2 | 22px | 700 | Section headings |
| h3 | 17px | 700 | Card titles |
| Body | 14-17px | 400/500 | UI text |
| Small | 11-14px | 500/600 | Labels, meta |

## Spacing & Layout

- Max-width: 1200px, centered
- Wrapper padding: 24px (→ 16px mobile)
- Grid: `repeat(auto-fill, minmax(270px, 1fr))`, gap 20px
- Breakpoint: 640px

### Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 8px | Inputs, past cards |
| `--radius-md` | 14px | Cards |
| `--radius-lg` | 20px | Hero, modals |
| Pill | 999px | Buttons, tabs |

### Shadows

- `--shadow-card`: `0 2px 12px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)`
- `--shadow-hover`: `0 8px 30px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.04)`

## Components

### Navigation
- Sticky top, surface + border-bottom
- Logo: display font, accent icon box (28px, rounded 8px)
- Links: muted → fg hover, active = bold
- Connect: pill toggle, dot indicator (muted/accent)

### Buttons
- **Primary:** accent fill, white text, pill, glow shadow, hover lift
- **Secondary:** transparent, border, pill, accent hover
- **Connect:** surface, border, pill, connected = accent tint + border
- All: hover, active (scale/translate), disabled (opacity 0.5), focus-visible (accent outline)

### Cards
- Surface + border + radius-md + shadow
- Hover: translateY(-3px) + shadow-hover
- 160px thumbnail with gradient + emoji
- Badge: absolute, pill, light bg + colored text
- `<article>` element for semantics

### Badges
- Active: `oklch(92% 0.04 170)` / `oklch(40% 0.10 170)`
- Ending soon: `oklch(90% 0.08 85)` / `oklch(45% 0.14 85)`
- Reserve met: `oklch(90% 0.06 145)` / `oklch(40% 0.12 145)`

### Tabs
- Pill container: surface + border, 4px padding
- Tab: muted → fg hover, active = accent fill + white
- ARIA: role="tablist", role="tab", aria-selected

### Past Cards
- Compact, opacity 0.65, hover 0.9
- Status pills: sold (green), not-met (warm), withdrawn (neutral)

### Form Elements
- Input: border-only, focus → accent + glow ring
- Error: danger border + inline message
- Select: custom arrow, same styling
- Upload: dashed border → solid accent

## Motion

- Default transition: `all .15s`
- Card hover: `all .2s`
- Toast: `all .4s`
- `prefers-reduced-motion`: all → 0.01ms

## Pages Built

| Page | File | Key Sections |
|------|------|-------------|
| **Listing** | `response.html` | Hero, tabs, active grid, past section |
| **Detail** | `cashu-auction-detail.html` | Item hero, bid panel, bid history |
| **Create** | `cashu-auction-create.html` | Form with validation, confirmation modal |
| **Dashboard** | `cashu-auction-dashboard.html` | Stats grid, active listings, active bids |

All pages share the same nav, footer, tokens, and component styles.
</artifact>

---

**Design system summary:**
- **Color:** 11 tokens, consistent across all pages
- **Typography:** 3 families + scale
- **Components:** nav, buttons, cards, tabs, badges, forms
- **Motion:** 0.15s default, `prefers-reduced-motion` supported
- **Screens:** 4 pages (Listing / Detail / Create / Dashboard)
- **Accessibility:** focus-visible, ARIA, prefers-reduced-motion

This design system can be extended with a How-it-Works page, user settings, and more.
