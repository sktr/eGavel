"use client";

import { useState, useEffect, useCallback } from "react";
import {
  deserializeProofs,
  getEncodedToken,
  Amount,
  MintQuoteState,
  PaymentRequest,
  PaymentRequestTransportType,
} from "@cashu/cashu-ts";
import { useWallet, useTotalBalance, loadStore, pickWithdrawMint, replaceMintProofs, walletPrivkeyHex, unspentWithoutP2PK, isP2PKSecret } from "../lib/wallet";
import { buildWallet } from "../lib/deterministic-wallet";
import { DEFAULT_MINT } from "../lib/config";
import { useIdentity } from "../lib/identity";
import { apiUrl } from "../lib/api";
import { bytesToHex } from "../lib/hex";
import { signSecretHex } from "../lib/claim";
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
  const { total, byMint, loading, refresh, stale } = useTotalBalance(pubkey);

  // Withdraw mint: the wallet may hold balances on several mints (Receive
  // accepts tokens from any mint), so let the user pick which one to spend.
  // Defaults to the app's fixed mint (config.ts), preserving the classic
  // single-mint behaviour.
  const [withdrawMint, setWithdrawMint] = useState<string>(DEFAULT_MINT);
  const activeWithdrawMint = pickWithdrawMint(byMint, withdrawMint, DEFAULT_MINT);

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

  // ── Receive (Cashu token) ───────────────────────────────────
  const [rcvToken, setRcvToken] = useState("");
  const [rcvBusy, setRcvBusy] = useState(false);
  const [rcvMsg, setRcvMsg] = useState<string | null>(null);
  const [rcvErr, setRcvErr] = useState<string | null>(null);

  const handleReceive = useCallback(async () => {
    setRcvErr(null);
    setRcvMsg(null);
    const token = rcvToken.trim();
    if (!token) {
      setRcvErr("Paste a Cashu token string");
      return;
    }
    setRcvBusy(true);
    try {
      const res = await wallet.receive(token);
      setRcvMsg(`Received ${res.amount.toLocaleString()} sats (${res.mint}).`);
      setRcvToken("");
      refresh();
    } catch (err) {
      setRcvErr(err instanceof Error ? err.message : String(err));
    } finally {
      setRcvBusy(false);
    }
  }, [rcvToken, wallet, refresh]);

  // ── Request payment (NUT-18): show a creqA QR so another Cashu wallet can
  // pay you. The transport target is this server's /api/wallet/receive; the
  // receiver id is the trading pubkey. Collected via "Check for payments".
  const [reqAmount, setReqAmount] = useState("100");
  const [reqCreq, setReqCreq] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqMsg, setReqMsg] = useState<string | null>(null);
  const [reqErr, setReqErr] = useState<string | null>(null);

  const handleCreateRequest = useCallback(() => {
    setReqErr(null);
    setReqMsg(null);
    setReqCreq(null);
    if (!identity) {
      setReqErr("Identity not available");
      return;
    }
    const amt = parseInt(reqAmount, 10);
    if (isNaN(amt) || amt <= 0) {
      setReqErr("Enter a valid amount");
      return;
    }
    try {
      const pr = new PaymentRequest(
        [
          {
            type: PaymentRequestTransportType.POST,
            target: apiUrl("/wallet/receive"),
          },
        ],
        identity.pubkey, // payment id = receiver's trading pubkey
        Amount.from(amt),
        "sat",
        [DEFAULT_MINT],
        "eGavel deposit",
        true, // single use
      );
      setReqCreq(pr.toEncodedRequest());
    } catch (err) {
      setReqErr(err instanceof Error ? err.message : String(err));
    }
  }, [identity, reqAmount]);

  // Collect pending NUT-18 payments into the wallet (signed GET).
  const handleCheckPayments = useCallback(async () => {
    setReqErr(null);
    setReqMsg(null);
    if (!identity) {
      setReqErr("Identity not available");
      return;
    }
    setReqBusy(true);
    try {
      const sig = signSecretHex(`wallet-receive:${identity.pubkey}`, bytesToHex(identity.secretKey));
      const res = await fetch(
        apiUrl(`/wallet/receive?receiver_pubkey=${identity.pubkey}&sig=${sig}`),
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "collect failed");
      }
      const data = (await res.json()) as {
        receipts: Array<{ mint_url: string; proofs: string; amount: number }>;
      };
      if (data.receipts.length === 0) {
        setReqMsg("No incoming payments.");
        return;
      }
      let total = 0;
      for (const r of data.receipts) {
        const proofs = deserializeProofs(r.proofs);
        await wallet.receive(
          getEncodedToken({ mint: r.mint_url, proofs }),
        ).catch(() => {});
        total += r.amount;
      }
      setReqMsg(`Collected ${total.toLocaleString()} sats.`);
      setReqCreq(null);
      refresh();
    } catch (err) {
      setReqErr(err instanceof Error ? err.message : String(err));
    } finally {
      setReqBusy(false);
    }
  }, [identity, wallet, refresh]);

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
      const mintUrl = activeWithdrawMint;
      const w = buildWallet(mintUrl);
      await w.loadMint();
      const store = loadStore(pubkey);
      const stored = deserializeProofs(store[mintUrl] ?? []);
      const { unspent } = await w.groupProofsByState(stored);
      // Leftover P2PK proofs (old un-swapped winner change) are 1-of-1 locked
      // to this wallet — sign them so the mint accepts the send. Proofs that
      // need another key are dropped (they cannot be spent here).
      const spendable = unspentWithoutP2PK(unspent);
      const ownP2PK = unspent.filter(
        (p) => typeof p.secret === "string" && isP2PKSecret(p.secret),
      );
      const skHex = walletPrivkeyHex(pubkey);
      let op = w.ops.send(Amount.from(amt), [...spendable, ...ownP2PK]).includeFees(true);
      if (skHex && ownP2PK.length > 0) op = op.privkey(skHex);
      const result = await op.run();
      if (result.send.length === 0) throw new Error("send produced no output proofs");
      replaceMintProofs(result.keep, mintUrl, pubkey);
      setWdToken(getEncodedToken({ mint: mintUrl, proofs: result.send }));
    } catch (err) {
      setWdErr(err instanceof Error ? err.message : String(err));
    } finally {
      setWdBusy(false);
    }
  }, [wdAmount, activeWithdrawMint, pubkey]);

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
      const mintUrl = activeWithdrawMint;
      const w = buildWallet(mintUrl);
      await w.loadMint();
      const quoteRes = await w.createMeltQuoteBolt11(invoice);
      const need = Number(quoteRes.amount) + Number(quoteRes.fee_reserve ?? 0);
      const store = loadStore(pubkey);
      const stored = deserializeProofs(store[mintUrl] ?? []);
      const { unspent } = await w.groupProofsByState(stored);
      const spendable = unspentWithoutP2PK(unspent);
      const ownP2PK = unspent.filter(
        (p) => typeof p.secret === "string" && isP2PKSecret(p.secret),
      );
      const skHex = walletPrivkeyHex(pubkey);
      let op = w.ops.send(Amount.from(need), [...spendable, ...ownP2PK]).includeFees(true);
      if (skHex && ownP2PK.length > 0) op = op.privkey(skHex);
      const result = await op.run();
      if (result.send.length === 0) throw new Error("insufficient balance for invoice + fees");
      const melt = await w.ops.meltBolt11(quoteRes, result.send).run();
      const keep = [...result.keep, ...(melt.change ?? [])];
      // Replace, not merge: the swap + melt consumed input proofs at the mint.
      // Keeping them would over-count the optimistic balance while the mint is
      // unreachable (the stale-number bug).
      replaceMintProofs(keep, mintUrl, pubkey);
      setLnMsg(`Paid ${Number(quoteRes.amount)} sats to the invoice.`);
      setLnInvoice("");
    } catch (err) {
      setLnErr(err instanceof Error ? err.message : String(err));
    } finally {
      setLnBusy(false);
    }
  }, [lnInvoice, activeWithdrawMint, pubkey]);

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
        <span style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8 }}>
          {loading ? "…" : total.toLocaleString()}{" "}
          <span style={{ fontSize: 15, fontWeight: 400, color: "var(--muted)" }}>sats</span>
          {stale && (
            <span
              className="material-icons"
              style={{ fontSize: 16, color: "var(--red)", cursor: "help" }}
              title="Mint unreachable — balance not verified (may be stale)"
              aria-label="Balance not verified — mint unreachable"
            >
              warning
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={refresh}
          style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", padding: "4px 10px", fontSize: 12 }}
        >
          Refresh
        </button>
      </div>
      {wallet.error && (
        <p
          style={{
            fontSize: 12,
            color: "var(--red)",
            margin: "0 0 12px",
            padding: "8px 12px",
            border: "1px solid color-mix(in srgb, var(--red) 30%, transparent)",
            borderRadius: "var(--radius)",
            background: "color-mix(in srgb, var(--red) 5%, transparent)",
            lineHeight: 1.6,
          }}
        >
          {wallet.error}
        </p>
      )}
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
        Funds live on the app&apos;s mint ({DEFAULT_MINT}) plus any mints you receive tokens
        from. Deposit via Lightning, receive a Cashu token, or withdraw as a token (import into
        any Cashu wallet) or by paying a Lightning invoice.
      </p>

      {/* ── Receive (Cashu token) ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>
          Receive Cashu token
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            value={rcvToken}
            onChange={(e) => setRcvToken(e.target.value)}
            placeholder="cashuA… (paste a token from any Cashu wallet)"
            autoComplete="off"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button
            type="button"
            onClick={handleReceive}
            disabled={rcvBusy || !wallet.ready}
            style={{ padding: "8px 18px", fontSize: 13 }}
          >
            {rcvBusy ? "Receiving…" : "Receive"}
          </button>
        </div>
        {rcvMsg && <p style={{ fontSize: 12, color: "var(--success)", marginTop: 4 }}>{rcvMsg}</p>}
        {rcvErr && <p style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>{rcvErr}</p>}
      </div>

      {/* ── Request payment (NUT-18 QR) ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>
          Request payment (QR)
        </label>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 8px", lineHeight: 1.5 }}>
          Show a QR another Cashu wallet (e.g. cashu.me) can scan to pay you. Payments arrive
          on this app&apos;s mint ({DEFAULT_MINT}) and are collected below.
        </p>
        {!reqCreq ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="number"
              min={1}
              value={reqAmount}
              onChange={(e) => setReqAmount(e.target.value)}
              placeholder="Amount (sats)"
              style={{ width: 140 }}
            />
            <button
              type="button"
              onClick={handleCreateRequest}
              disabled={!identity}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              Show QR
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
              <QRCodeSVG
                value={reqCreq}
                size={168}
                bgColor="transparent"
                fgColor="var(--fg)"
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleCheckPayments}
                disabled={reqBusy}
                style={{ padding: "8px 18px", fontSize: 13 }}
              >
                {reqBusy ? "Checking…" : "Check for payments"}
              </button>
              <button
                type="button"
                onClick={() => setReqCreq(null)}
                style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", padding: "8px 18px", fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
              Scan with a NUT-18 compatible Cashu wallet. Once paid, the token is held for you
              until you collect it here.
            </p>
          </div>
        )}
        {reqMsg && <p style={{ fontSize: 12, color: "var(--success)", marginTop: 4 }}>{reqMsg}</p>}
        {reqErr && <p style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>{reqErr}</p>}
      </div>

      {/* ── Deposit ── */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>
          Deposit sats (Lightning)
        </label>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 8px", lineHeight: 1.5 }}>
          Auctions run on the app&apos;s mint ({DEFAULT_MINT}). To bid, your sats must be
          minted here — deposits via Lightning land on this mint. Tokens received from
          another mint (see above) can be withdrawn but not used to bid; convert them
          via Lightning first.
        </p>
        {depositStep === "idle" || depositStep === "claiming" ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {/* One-tap wallet launch on mobile (same affordance as the bid form) */}
              <a
                href={`lightning:${quote.request}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--fg)",
                  padding: "6px 14px",
                  fontSize: 12,
                  textDecoration: "none",
                }}
              >
                <span className="material-icons" style={{ fontSize: 14 }}>bolt</span>
                Pay with wallet
              </a>
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <select
            value={withdrawMint}
            onChange={(e) => setWithdrawMint(e.target.value)}
            style={{ maxWidth: 260, fontSize: 12 }}
          >
            {byMint.length === 0 && <option value={DEFAULT_MINT}>{DEFAULT_MINT}</option>}
            {byMint.map((m) => (
              <option key={m.mint} value={m.mint}>
                {m.mint} ({m.amount.toLocaleString()} sats)
              </option>
            ))}
          </select>
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
            {/* NUT-16 static QR: a small token (≤ a few proofs) fits one QR
              code; mobile Cashu wallets (Minibits, cashu.me) can scan it to
              receive. Larger tokens fall back to the copy field below. */}
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
              <QRCodeSVG
                value={wdToken}
                size={168}
                bgColor="transparent"
                fgColor="var(--fg)"
              />
            </div>
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
              Scan the QR with any Cashu wallet (e.g. Minibits), or copy the token to import it.
              Treat it like cash — anyone with it can redeem it.
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <select
            value={withdrawMint}
            onChange={(e) => setWithdrawMint(e.target.value)}
            style={{ maxWidth: 260, fontSize: 12 }}
          >
            {byMint.length === 0 && <option value={DEFAULT_MINT}>{DEFAULT_MINT}</option>}
            {byMint.map((m) => (
              <option key={m.mint} value={m.mint}>
                {m.mint} ({m.amount.toLocaleString()} sats)
              </option>
            ))}
          </select>
          <input
            type="text"
            value={lnInvoice}
            onChange={(e) => setLnInvoice(e.target.value)}
            placeholder="lnbc… (paste a Lightning invoice to pay from your balance)"
            autoComplete="off"
            style={{ flex: 1, minWidth: 220 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
