# Lightning Invoice QR + Wallet Deep Link Spec

Date: 2026-08-13
Status: accepted (design approved; implementation is based on this spec)

---

## 1. Background and Problems

When a bidder tops up their in-app wallet via Lightning (the `mintStep ===
"awaiting"` state in `apps/web/app/auctions/[id]/bid-form.tsx`, lines
~568-609), the UI shows the bolt11 invoice in a read-only textarea plus a
"Copy Invoice" button.

Problems:

1. **Mobile is awkward.** To pay, the user must copy the invoice, switch to
   their Lightning wallet app, paste it, and switch back. No one-tap path.
2. **PC → mobile is unsupported.** There is no way to pay a PC-displayed
   invoice from a phone — a QR code is the standard solution.

This spec adds a QR code (scanned by a phone wallet) and a Lightning deep
link (one-tap wallet launch on mobile).

## 2. Decisions (agreed during brainstorming)

| Decision | Choice |
|----------|--------|
| QR library | `qrcode.react` (`QRCodeSVG`) |
| QR payload | `lightning:<bolt11>` (BIP-21-style prefix — scanners open the wallet directly) |
| Deep link | `lightning:<bolt11>` via an `<a href>` "Pay with wallet" button |
| Existing controls | Copy Invoice button stays; the bolt11 textarea stays but collapses behind a toggle |
| 1-sats listing | NOT changed (already supported; placeholder stays "1000") |

## 3. Dependency

Add to `apps/web/package.json`:

```
qrcode.react
```

Install with pnpm.

## 4. `apps/web/app/auctions/[id]/bid-form.tsx` changes

### 4.1 Import

```tsx
import { QRCodeSVG } from "qrcode.react"
```

### 4.2 Replace the invoice display block (lines ~568-609)

Current structure: textarea (bolt11) + [Copy Invoice] button + status text.

New structure (same `mintStep === "awaiting" && mintQuote` branch):

```tsx
<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
  {/* QR code — scan with a phone wallet (PC display use case) */}
  <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
    <QRCodeSVG
      value={`lightning:${mintQuote.request}`}
      size={168}
      bgColor="transparent"
      fgColor="var(--fg)"
    />
  </div>
  {/* Collapsible raw invoice */}
  <details>
    <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
      Show invoice text
    </summary>
    <textarea
      readOnly
      rows={3}
      value={mintQuote.request}
      style={{
        width: "100%",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "8px 12px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        background: "var(--bg)",
        color: "var(--fg)",
        resize: "none",
        marginTop: 4,
      }}
    />
  </details>
  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
    {/* One-tap wallet launch on mobile */}
    <a
      href={`lightning:${mintQuote.request}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--surface)",
        color: "var(--fg)",
        padding: "6px 14px",
        fontSize: 12,
        textDecoration: "none",
        fontFamily: "inherit",
        lineHeight: 1.4,
      }}
    >
      <span className="material-icons" style={{ fontSize: 14 }}>bolt</span>
      Pay with wallet
    </a>
    <button
      type="button"
      onClick={handleCopyInvoice}
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--surface)",
        color: "var(--fg)",
        padding: "6px 14px",
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        lineHeight: 1.4,
      }}
    >
      Copy Invoice
    </button>
    <span style={{ fontSize: 12, color: "var(--muted)" }}>
      {DEV_TOOLS
        ? "Waiting for payment — testnut auto-pays in a few seconds…"
        : "Waiting for payment — pay the invoice with your Lightning wallet (Minibits, Alby, Phoenix…)"}
    </span>
  </div>
  {DEV_TOOLS && (
    <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
      Paying externally?{" "}
      <a
        href="https://faucet.lightning.community/"
        target="_blank"
        rel="noopener"
        style={{ color: "var(--accent)" }}
      >
        Lightning Faucet
      </a>
    </p>
  )}
</div>
```

Notes:
- The `details`/`summary` element (used elsewhere in this file, e.g. the
  Advanced Settings `<summary>` at ~line 381) collapses the raw invoice so
  the QR is the primary visual.
- The `lightning:` prefix on the QR payload means phone wallets that scan it
  open directly to the payment screen (BIP-21 style). If a wallet does not
  handle it, scanning a bare bolt11 also works — but the prefix is the
  standard.
- The deep-link `<a href="lightning:...">` gives mobile one-tap wallet
  launch; on desktop it degrades to a no-op (browsers ignore unknown
  schemes) — the QR + copy remain the desktop paths.

## 5. Scope

- Only `bid-form.tsx` and `apps/web/package.json` (+ lockfile).
- No server changes, no other UI changes.
- 1-sats listing behavior unchanged.

## 6. Testing

- **Web**: no component test harness (`lib/**/*.test.ts` only). Verify with
  `pnpm --filter @egavel/web run typecheck` + `pnpm --filter @egavel/web run
  build` + manual browser pass:
  - Trigger the mint flow (DEV_TOOLS mode uses testnut, which auto-pays —
    the invoice appears briefly) and confirm the QR renders, the "Pay with
    wallet" link has `href="lightning:...`", and Copy Invoice still works.
  - The raw invoice text collapses behind "Show invoice text".
- **Server**: no changes; full server suite must still pass.

## 7. Files touched

| File | Change |
|------|--------|
| `apps/web/package.json` | add `qrcode.react` |
| `apps/web/app/auctions/[id]/bid-form.tsx` | QR + deep link + collapsible invoice |
| `pnpm-lock.yaml` | updated by install |
