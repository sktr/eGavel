# Lightning Invoice QR + Wallet Deep Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a QR code and a "Pay with wallet" Lightning deep link to the invoice display in the bid form, so mobile users can pay in one tap and PC users can scan with a phone.

**Architecture:** Add the `qrcode.react` dependency, then replace the invoice display block in `apps/web/app/auctions/[id]/bid-form.tsx` with: a centered `QRCodeSVG` (payload `lightning:<bolt11>`), a collapsible raw invoice (`details`/`summary`), and a row with a deep-link `<a href="lightning:<bolt11>">` "Pay with wallet" button plus the existing Copy Invoice button and status text.

**Tech Stack:** Next.js 15 (client component), `qrcode.react`, Material Icons, inline styles.

## Global Constraints

- QR payload: `lightning:${mintQuote.request}` (BIP-21-style prefix).
- Deep link href: `lightning:${mintQuote.request}`.
- The existing `handleCopyInvoice` callback and the DEV_TOOLS block (Lightning Faucet link) are UNCHANGED.
- The raw bolt11 textarea collapses behind a `<details>`/`<summary>` ("Show invoice text") — the `details`/`summary` pattern already exists in this file (Advanced Settings).
- Verification: `pnpm --filter @egavel/web run typecheck` + `pnpm --filter @egavel/web run build`; server suite unaffected.
- pnpm is at `/Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm` (not on PATH).

---

### Task 1: Add qrcode.react dependency

**Files:**
- Modify: `apps/web/package.json`
- Update: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `qrcode.react` available for import as `QRCodeSVG` in the web app.

- [ ] **Step 1: Install the dependency**

```bash
cd /Users/sktr/repo/cashu-auction
/Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm --filter @egavel/web add qrcode.react
```

- [ ] **Step 2: Verify it's in package.json**

Run: `grep "qrcode.react" apps/web/package.json`
Expected: a dependency entry like `"qrcode.react": "^4.x.x"`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add qrcode.react for invoice QR display"
```

---

### Task 2: Replace the invoice display block with QR + deep link

**Files:**
- Modify: `apps/web/app/auctions/[id]/bid-form.tsx`

**Interfaces:**
- Consumes: `mintQuote.request` (bolt11 string), `handleCopyInvoice`, `DEV_TOOLS`.
- Produces: the `mintStep === "awaiting" && mintQuote` branch renders a QR code, a collapsible invoice, and a deep-link pay button.

- [ ] **Step 1: Add the import**

At the top of `apps/web/app/auctions/[id]/bid-form.tsx` (after the existing imports):

```tsx
import { QRCodeSVG } from "qrcode.react"
```

- [ ] **Step 2: Replace the invoice display block**

Find the `mintStep === "awaiting" && mintQuote` branch (the `<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>` that contains the read-only textarea with `value={mintQuote.request}`, the Copy Invoice button, and the status text). Replace its inner content with the spec's new structure: centered `QRCodeSVG` (size 168, `bgColor="transparent"`, `fgColor="var(--fg)"`, value `lightning:${mintQuote.request}`), the collapsible `details`/`summary` with the textarea, and the button row with the "Pay with wallet" `<a href={`lightning:${mintQuote.request}`}>` + Copy Invoice button + status span. Keep the DEV_TOOLS block (Lightning Faucet link) as-is.

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/sktr/repo/cashu-auction && /Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm --filter @egavel/web run typecheck`
Expected: no type errors.

- [ ] **Step 4: Verify build**

Run: `cd /Users/sktr/repo/cashu-auction && /Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm --filter @egavel/web run build`
Expected: production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/auctions/[id]/bid-form.tsx
git commit -m "feat: show Lightning invoice QR + one-tap pay-with-wallet deep link"
```

---

### Task 3: Full verification

**Files:**
- No code changes.

- [ ] **Step 1: Run the test suites**

Run: `cd /Users/sktr/repo/cashu-auction && /Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm --filter @egavel/server run test && /Users/sktr/.local/share/mise/installs/node/22.22.3/bin/pnpm --filter @egavel/web run test`
Expected: server 112/112, web 25/25.

- [ ] **Step 2: Manual browser pass (DEV_TOOLS mode)**

With the dev server (or the deployed app in DEV_TOOLS), open an auction's bid form and trigger the mint flow so an invoice appears:
- The QR code renders (168px, uses `--fg` color).
- The "Pay with wallet" link's `href` starts with `lightning:`.
- Clicking "Show invoice text" reveals the raw bolt11.
- Copy Invoice still copies the bolt11.

- [ ] **Step 3: Commit any fixups**

```bash
git status
git add -A
git commit -m "fix: final verification fixes"
```

(Only commit if there are actual changes.)
