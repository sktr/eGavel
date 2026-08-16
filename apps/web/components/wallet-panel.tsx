"use client";

import { useState, useEffect, useCallback } from "react";
import {
  deserializeProofs,
  getEncodedToken,
  Amount,
  MintQuoteState,
} from "@cashu/cashu-ts";
import { useWallet, useTotalBalance, storeProofsInWallet, loadStore } from "../lib/wallet";
import { buildWallet } from "../lib/deterministic-wallet";
import { DEFAULT_MINT } from "../lib/config";
import { useIdentity } from "../lib/identity";
import { QRCodeSVG } from "qrcode.react";

/**
 * Dashboard wallet panel: deposit sats via Lightning (mint) and withdraw them
 * as a Cashu token (any Cashu wallet) or by paying a Lightning invoice
 * (melt). All ops run on the app's single fixed mint (config.ts).
 */
export function WalletPanel() {
  const { identity } = useIdentity();
  const pubkey = identity?.pubkey ?? "";
  const wallet = useWallet(DEFAULT_MINT, pubkey);
  const { total, loading, refresh } = useTotalBalance(pubkey);

  const [copied, setCopied] = useState<string | null>(null);
  const copyText = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard unavailable
    }
  }, []);

  // ── Deposit (Lightning mint) ────────────────────────────────
  const [depositAmount, setDepositAmount] = useState("100");
  const [quote, setQuote] = useState<{ quote: string; request: string; amount: number } | null>(
    null,
  );
  const [depositStep, setDepositStep] = useState<"idle" | "awaiting" | "claiming" | "done">(
    "idle",
  );
  const [depositMsg, setDepositMsg] = useState<string | null>(null);
  const [depositErr, setDepositErr] = useState<string | null>(null);

  const handleDeposit = useCallback(async () => {
    setDepositErr(null);
    setDepositMsg(null);
    setQuote(null);
    const amt = parseInt(depositAmount, 10);
    if (isNaN(amt) || amt <= 0) {
      setDepositErr("Enter a valid amount");
      return;
    }
    try {
      const q = await wallet.requestMint(amt);
      setQuote({ quote: q.quote, request: q.request, amount: Number(q.amount) });
      setDepositStep("awaiting");
      setDepositMsg("Pay the Lightning invoice to mint sats — auto-detected once paid.");
    } catch (err) {
      setDepositErr(`mint request failed: ${err instanceof Error ? err.message : String(err)}`);
      setDepositStep("idle");
    }
  }, [depositAmount, wallet]);

  useEffect(() => {
    if (depositStep !== "awaiting" || !quote) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const checked = await wallet.checkMintQuote(quote.quote);
        if (cancelled) return;
        if (checked.state === MintQuoteState.PAID) {
          clearInterval(timer);
          setDepositStep("claiming");
          setDepositMsg("Payment received — minting tokens…");
          await wallet.claimMint(quote.amount, checked);
          if (cancelled) return;
          setDepositStep("done");
          setDepositMsg(`Deposited ${quote.amount} sats.`);
          wallet.refresh();
        }
      } catch {
        // transient — keep polling
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [depositStep, quote, wallet]);

  // ── Withdraw (Cashu token) ──────────────────────────────────
  const [wdAmount, setWdAmount] = useState("");
  const [wdToken, setWdToken] = useState<string | null>(null);
  const [wdBusy, setWdBusy] = useState(false);
  const [wdErr, setWdErr] = useState<string | null>(null);

  const handleWithdrawToken = useCallback(async () => {
    setWdErr(null);
    setWdToken(null);
    const amt = parseInt(wdAmount, 10);
    if (isNaN(amt) || amt <= 0) {
      setWdErr("Enter a valid amount");
      return;
    }
    setWdBusy(true);
    try {
      const w = buildWallet(DEFAULT_MINT);
      await w.loadMint();
      const store = loadStore(pubkey);
      const stored = deserializeProofs(store[DEFAULT_MINT] ?? []);
      const { unspent } = await w.groupProofsByState(stored);
      if (unspent.length === 0) throw new Error("no spendable balance on this mint");
      const result = await w.ops.send(Amount.from(amt), unspent).includeFees(true).run();
      if (result.send.length === 0) throw new Error("send produced no output proofs");
      storeProofsInWallet(result.keep, DEFAULT_MINT, pubkey);
      setWdToken(getEncodedToken({ mint: DEFAULT_MINT, proofs: result.send }));
    } catch (err) {
      setWdErr(err instanceof Error ? err.message : String(err));
    } finally {
      setWdBusy(false);
    }
  }, [wdAmount]);

  // ── Withdraw (Lightning melt) ───────────────────────────────
  const [lnInvoice, setLnInvoice] = useState("");
  const [lnBusy, setLnBusy] = useState(false);
  const [lnMsg, setLnMsg] = useState<string | null>(null);
  const [lnErr, setLnErr] = useState<string | null>(null);

  const handleWithdrawLightning = useCallback(async () => {
    setLnErr(null);
    setLnMsg(null);
    const invoice = lnInvoice.trim();
    if (!invoice) {
      setLnErr("Paste a Lightning invoice");
      return;
    }
    setLnBusy(true);
    try {
      const w = buildWallet(DEFAULT_MINT);
      await w.loadMint();
      const quoteRes = await w.createMeltQuoteBolt11(invoice);
      const need = Number(quoteRes.amount) + Number(quoteRes.fee_reserve ?? 0);
      const store = loadStore(pubkey);
      const stored = deserializeProofs(store[DEFAULT_MINT] ?? []);
      const { unspent } = await w.groupProofsByState(stored);
      const result = await w.ops.send(Amount.from(need), unspent).includeFees(true).run();
      if (result.send.length === 0) throw new Error("insufficient balance for invoice + fees");
      const melt = await w.ops.meltBolt11(quoteRes, result.send).run();
      const keep = [...result.keep, ...(melt.change ?? [])];
      storeProofsInWallet(keep, DEFAULT_MINT, pubkey);
      setLnMsg(`Paid ${Number(quoteRes.amount)} sats to the invoice.`);
      setLnInvoice("");
    } catch (err) {
      setLnErr(err instanceof Error ? err.message : String(err));
    } finally {
      setLnBusy(false);
    }
  }, [lnInvoice]);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 24,
        marginBottom: 40,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="material-icons" style={{ fontSize: 18, color: "var(--accent)" }}>
          account_balance_wallet
        </span>
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>Wallet</h2>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 20 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 600 }}>
          {loading ? "…" : total.toLocaleString()}{" "}
          <span style={{ fontSize: 15, fontWeight: 400, color: "var(--muted)" }}>sats</span>
        </span>
        <button
          type="button"
          onClick={refresh}
          style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", padding: "4px 10px", fontSize: 12 }}
        >
          Refresh
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
        All funds live on the app&apos;s single mint ({DEFAULT_MINT}). Deposit via Lightning, or
        withdraw as a Cashu token (import into any Cashu wallet) or by paying a Lightning invoice.
      </p>

      {/* ── Deposit ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>
          Deposit sats (Lightning)
        </label>
        {depositStep === "idle" || depositStep === "claiming" ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min={1}
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              style={{ width: 120 }}
            />
            <button
              type="button"
              onClick={handleDeposit}
              disabled={depositStep === "claiming" || !wallet.ready}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              {depositStep === "claiming" ? "Minting…" : "Deposit"}
            </button>
          </div>
        ) : null}
        {depositStep === "awaiting" && quote && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
              <QRCodeSVG
                value={`lightning:${quote.request}`}
                size={168}
                bgColor="transparent"
                fgColor="var(--fg)"
              />
            </div>
            <textarea
              readOnly
              rows={2}
              value={quote.request}
              style={{ width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 10px", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => copyText("invoice", quote.request)}
                style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", padding: "6px 14px", fontSize: 12 }}
              >
                {copied === "invoice" ? "Copied ✓" : "Copy invoice"}
              </button>
              <button
                type="button"
                onClick={() => setDepositStep("idle")}
                style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", padding: "6px 14px", fontSize: 12 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {depositStep === "done" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--success)" }}>{depositMsg}</span>
            <button
              type="button"
              onClick={() => setDepositStep("idle")}
              style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", padding: "6px 14px", fontSize: 12 }}
            >
              Deposit more
            </button>
          </div>
        )}
        {depositMsg && depositStep !== "done" && (
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{depositMsg}</p>
        )}
        {depositErr && <p style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>{depositErr}</p>}
      </div>

      {/* ── Withdraw (token) ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>
          Withdraw as Cashu token
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            type="number"
            min={1}
            value={wdAmount}
            onChange={(e) => setWdAmount(e.target.value)}
            placeholder="Amount (sats)"
            style={{ width: 140 }}
          />
          <button
            type="button"
            onClick={handleWithdrawToken}
            disabled={wdBusy}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {wdBusy ? "Preparing…" : "Withdraw token"}
          </button>
        </div>
        {wdToken && (
          <div>
            <textarea
              readOnly
              rows={3}
              value={wdToken}
              style={{ width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 10px", resize: "vertical", wordBreak: "break-all", marginBottom: 8 }}
            />
            <button
              type="button"
              onClick={() => copyText("token", wdToken)}
              style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", padding: "6px 14px", fontSize: 12 }}
            >
              {copied === "token" ? "Copied ✓" : "Copy token"}
            </button>
            <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              Import this token into any Cashu wallet (e.g. Minibits) to spend it there. Treat it
              like cash — anyone with it can redeem it.
            </p>
          </div>
        )}
        {wdErr && <p style={{ fontSize: 12, color: "var(--red)" }}>{wdErr}</p>}
      </div>

      {/* ── Withdraw (Lightning) ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>
          Withdraw via Lightning
        </label>
        <input
          type="text"
          value={lnInvoice}
          onChange={(e) => setLnInvoice(e.target.value)}
          placeholder="lnbc… (paste a Lightning invoice to pay from your balance)"
          autoComplete="off"
          style={{ marginBottom: 8 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={handleWithdrawLightning}
            disabled={lnBusy}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {lnBusy ? "Paying…" : "Pay invoice"}
          </button>
          {lnMsg && <span style={{ fontSize: 12, color: "var(--success)" }}>{lnMsg}</span>}
          {lnErr && <span style={{ fontSize: 12, color: "var(--red)" }}>{lnErr}</span>}
        </div>
      </div>
    </div>
  );
}
