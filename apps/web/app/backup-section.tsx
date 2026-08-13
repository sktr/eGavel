"use client";

import { useState } from "react";
import { useIdentity } from "../lib/identity";
import { bytesToHex } from "../lib/hex";

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
        These 12 words (or the secret key) are your account. Restore it after clearing browser data
        or on another device by entering the same phrase. Never share it with anyone.
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
    </div>
  );
}
