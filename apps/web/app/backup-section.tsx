"use client";

import { useState } from "react";
import { useIdentity } from "../lib/identity";
import { bytesToHex } from "../lib/hex";
import { exportWalletBackup, importWalletBackup } from "../lib/wallet-backup";
import { recoverBalanceFromSeed } from "../lib/deterministic-wallet";

/**
 * Account backup section: shows/copies the 12-word recovery phrase and
 * provides a restore form (phrase or hex secret key).
 * Legacy accounts (no phrase) display the raw hex secret key instead.
 */
export function BackupSection() {
  const { identity, restore } = useIdentity();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phrase = identity?.recoveryPhrase ?? null;
  const legacyKey = identity?.secretKey ? bytesToHex(identity.secretKey) : null;

  const copy = async () => {
    const text = phrase ?? legacyKey;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setError(null);
    if (!input.trim()) {
      setError("Enter a 12-word phrase or a 64-char hex secret key");
      return;
    }
    const res = restore(input);
    if (res.ok) {
      setStatus("Restored — this device now uses the restored account.");
      setInput("");
    } else {
      setError(
        res.error === "INVALID_RECOVERY_INPUT" ? "Invalid input" : (res.error ?? "Restore failed"),
      );
    }
  };

  // ── Wallet (device-local unspent balance) export / import ────────────
  const [walletBlob, setWalletBlob] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const exportWallet = () => {
    setWalletError(null);
    setWalletStatus(null);
    try {
      setWalletBlob(exportWalletBackup());
    } catch {
      setWalletError("could not read the wallet");
    }
  };

  const copyWallet = async () => {
    if (!walletBlob) return;
    try {
      await navigator.clipboard.writeText(walletBlob);
      setWalletStatus("Backup copied — keep it somewhere safe. Anyone with it can spend these sats.");
      setTimeout(() => setWalletStatus(null), 2500);
    } catch {
      // clipboard unavailable
    }
  };

  const importWallet = (e: React.FormEvent) => {
    e.preventDefault();
    setWalletError(null);
    setWalletStatus(null);
    try {
      const results = importWalletBackup(importText.trim());
      if (results.length === 0) {
        setWalletStatus("No wallets found in the backup.");
      } else {
        setWalletStatus(
          `Imported ${results
            .map((r) => `${r.amount} sats (${r.mint})`)
            .join(", ")}. Refresh the balance in the header.`,
        );
      }
      setImportText("");
      setWalletBlob(null);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "import failed");
    }
  };

  // ── Recover balance from seed (NUT-13) ──────────────────────────────
  const [extraMints, setExtraMints] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoverStatus, setRecoverStatus] = useState<string | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  const handleRecover = async () => {
    if (!phrase) return;
    setRecovering(true);
    setRecoverError(null);
    setRecoverStatus(null);
    try {
      const known = Object.keys(
        JSON.parse(localStorage.getItem("cashu-wallet-v1") ?? "{}") as Record<string, unknown>,
      );
      const extra = extraMints
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const mints = [...new Set([...known, ...extra])];
      if (mints.length === 0) {
        setRecoverError("No mints to scan — add mint URLs above.");
        return;
      }
      const results = await recoverBalanceFromSeed({
        mnemonic: phrase,
        mintUrls: mints,
        onProgress: (m) => setRecoverStatus(m),
      });
      const total = results.reduce((a, r) => a + r.recovered, 0);
      setRecoverStatus(
        `Recovered ${total.toLocaleString()} sats (${results
          .map((r) => `${r.mint}: ${r.recovered}`)
          .join(", ")}). Refresh the balance in the header.`,
      );
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : "recovery failed");
    } finally {
      setRecovering(false);
    }
  };

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
          key
        </span>
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>Account backup</h2>
      </div>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
        These 12 words (or the secret key) restore your account key and the funds locked in your
        bids — from any device. They do <strong>not</strong> include this device's unspent wallet
        balance: Cashu tokens live in this browser only. Move that balance with the wallet backup
        below. Never share the phrase with anyone.
      </p>

      {phrase ? (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "14px 18px",
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              lineHeight: 1.8,
              marginBottom: 8,
              userSelect: "all",
            }}
          >
            {revealed
              ? phrase
              : phrase
                  .split(" ")
                  .map(() => "••••")
                  .join(" ")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--fg)",
                padding: "6px 14px",
                fontSize: 13,
              }}
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
            <button
              type="button"
              onClick={copy}
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--fg)",
                padding: "6px 14px",
                fontSize: 13,
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      ) : legacyKey ? (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: "var(--amber)", marginBottom: 6 }}>
            This account predates the recovery-phrase format. Back up the secret key below.
          </p>
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "10px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              wordBreak: "break-all",
              marginBottom: 8,
            }}
          >
            {revealed ? legacyKey : "••••••••••••••••••••••••••••••••"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--fg)",
                padding: "6px 14px",
                fontSize: 13,
              }}
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
            <button
              type="button"
              onClick={copy}
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--fg)",
                padding: "6px 14px",
                fontSize: 13,
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <label htmlFor="restore-input" style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Restore from another device/browser
        </label>
        <input
          id="restore-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="12-word phrase (or 64-char secret key)"
          autoComplete="off"
          style={{ marginBottom: 8 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="submit" style={{ padding: "8px 18px", fontSize: 13 }}>
            Restore
          </button>
          {status && <span style={{ fontSize: 12, color: "var(--success)" }}>{status}</span>}
          {error && <span style={{ fontSize: 12, color: "var(--red)" }}>{error}</span>}
        </div>
        <p style={{ fontSize: 11, color: "var(--amber)", marginTop: 8 }}>
          ⚠ Restoring replaces the current key. Active bids and listings are not carried over to the
          new key.
        </p>
      </form>

      {/* ── Wallet balance backup (device-local unspent tokens) ── */}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>
          Wallet balance (this browser)
        </label>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
          Your unspent tokens are stored only in this browser and are not included in the recovery
          phrase. To move them to another device, export them here and import the backup there.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <button type="button" onClick={exportWallet} style={{ padding: "8px 18px", fontSize: 13 }}>
            Export wallet
          </button>
          {walletBlob && (
            <button
              type="button"
              onClick={copyWallet}
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--fg)",
                padding: "8px 18px",
                fontSize: 13,
              }}
            >
              Copy backup
            </button>
          )}
        </div>

        {walletBlob && (
          <textarea
            readOnly
            rows={4}
            value={walletBlob}
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "10px 12px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              background: "var(--bg)",
              color: "var(--fg)",
              resize: "vertical",
              marginBottom: 12,
              wordBreak: "break-all",
            }}
          />
        )}

        <form onSubmit={importWallet} style={{ marginTop: 4 }}>
          <label htmlFor="wallet-import" style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Import wallet backup
          </label>
          <textarea
            id="wallet-import"
            rows={3}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='Paste the wallet backup JSON from another device (starts with {"version":1,...)'
            autoComplete="off"
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "10px 12px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              background: "var(--surface)",
              color: "var(--fg)",
              resize: "vertical",
              marginBottom: 8,
              wordBreak: "break-all",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="submit" style={{ padding: "8px 18px", fontSize: 13 }}>
              Import
            </button>
            {walletStatus && (
              <span style={{ fontSize: 12, color: "var(--success)" }}>{walletStatus}</span>
            )}
            {walletError && <span style={{ fontSize: 12, color: "var(--red)" }}>{walletError}</span>}
          </div>
        </form>

      {/* ── Recover balance from seed (NUT-13) ── */}
      {phrase && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "block" }}>
            Recover balance from seed
          </label>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, lineHeight: 1.6 }}>
            Regenerates the balance this account created after NUT-13 backups were enabled, using
            the recovery phrase. Pre-existing balance (older tokens) moves via the wallet export
            above.
          </p>
          <input
            type="text"
            value={extraMints}
            onChange={(e) => setExtraMints(e.target.value)}
            placeholder="Extra mint URLs (comma-separated, optional)"
            autoComplete="off"
            style={{ marginBottom: 8 }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={handleRecover} disabled={recovering} style={{ padding: "8px 18px", fontSize: 13 }}>
              {recovering ? "Recovering…" : "Recover balance"}
            </button>
            {recoverStatus && <span style={{ fontSize: 12, color: "var(--success)" }}>{recoverStatus}</span>}
            {recoverError && <span style={{ fontSize: 12, color: "var(--red)" }}>{recoverError}</span>}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
