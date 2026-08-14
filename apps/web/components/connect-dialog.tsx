"use client"

import { useState } from "react"

/**
 * Connect dialog shown when a logged-out user presses "Connect".
 * Offers two paths: use the account stored on this device (same key as
 * before), or restore a different account from a recovery phrase / secret key.
 */
export function ConnectDialog({
  onUseDevice,
  onRestore,
  onClose,
}: {
  onUseDevice: () => void
  onRestore: (input: string) => { ok: boolean; error?: string }
  onClose: () => void
}) {
  const [mode, setMode] = useState<"device" | "restore">("device");
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (mode === "device") {
      onUseDevice();
      return;
    }
    const res = onRestore(phrase.trim());
    if (!res.ok) {
      setError(res.error ?? "restore failed");
      return;
    }
    onClose();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          width: "100%",
          maxWidth: 420,
          boxShadow: "var(--shadow-hover)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            marginBottom: 16,
          }}
        >
          Connect to eGavel
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              setMode("device");
              setError(null);
            }}
            aria-pressed={mode === "device"}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "14px 16px",
              borderRadius: "var(--radius)",
              border: `1px solid ${mode === "device" ? "var(--accent)" : "var(--border)"}`,
              background:
                mode === "device"
                  ? "color-mix(in srgb, var(--accent) 6%, transparent)"
                  : "var(--surface)",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
              transition: "border-color .15s, background .15s",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: `2px solid ${mode === "device" ? "var(--accent)" : "var(--border)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 1,
              }}
            >
              {mode === "device" && (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "var(--accent)",
                  }}
                />
              )}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>
                Use the account on this device
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Sign in with the key already saved in this browser.
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("restore");
              setError(null);
            }}
            aria-pressed={mode === "restore"}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "14px 16px",
              borderRadius: "var(--radius)",
              border: `1px solid ${mode === "restore" ? "var(--accent)" : "var(--border)"}`,
              background:
                mode === "restore"
                  ? "color-mix(in srgb, var(--accent) 6%, transparent)"
                  : "var(--surface)",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
              transition: "border-color .15s, background .15s",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: `2px solid ${mode === "restore" ? "var(--accent)" : "var(--border)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 1,
              }}
            >
              {mode === "restore" && (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "var(--accent)",
                  }}
                />
              )}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>
                Restore from a recovery phrase
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Switch to a different account using your 12-word phrase (or secret key).
              </span>
            </span>
          </button>
        </div>

        {mode === "restore" && (
          <textarea
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="12-word recovery phrase (or 64-char secret key)"
            rows={2}
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "10px 14px",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              background: "var(--bg)",
              color: "var(--fg)",
              resize: "vertical",
              marginTop: 4,
            }}
          />
        )}

        {error && (
          <p style={{ color: "var(--red)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--surface)",
              color: "var(--fg)",
              padding: "8px 20px",
              fontSize: 14,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            style={{
              border: "none",
              borderRadius: "var(--radius)",
              background: "var(--accent)",
              color: "#fff",
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
