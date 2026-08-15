"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "../lib/identity";
import { bytesToHex } from "../lib/hex";
import { hexToNpub, nostrAtProfileUrl } from "../lib/npub";
import {
  detectNostrExtension,
  fetchNostrLinkStatus,
  linkNostr,
  linkNostrWithNsec,
} from "../lib/nostr-link";

/**
 * Link Nostr: binds the account's trading key to a Nostr pubkey, either via a
 * NIP-07 browser extension (Alby, nos2x, ...) or by pasting an nsec private
 * key. A linked seller shows a "Nostr verified" badge on their listings so
 * buyers can reach them on nostr.at.
 *
 * The nsec path is non-custodial: the key is used only to sign the NIP-98
 * link event client-side and is never persisted or sent to the server.
 */
export function IdentityNostrSection() {
  const { identity } = useIdentity();
  const [hasExtension, setHasExtension] = useState(false);
  const [nostrPubkey, setNostrPubkey] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<"unknown" | "linked" | "unlinked">("unknown");
  const [busy, setBusy] = useState(false);
  const [nsecInput, setNsecInput] = useState("");
  const [nsecBusy, setNsecBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHasExtension(detectNostrExtension());
    if (!identity) return;
    let cancelled = false;
    setLinkStatus("unknown");
    (async () => {
      try {
        const st = await fetchNostrLinkStatus(
          identity.pubkey,
          bytesToHex(identity.secretKey),
        );
        if (cancelled) return;
        if (st.ok && st.nostrPubkey) {
          setNostrPubkey(st.nostrPubkey);
          setLinkStatus("linked");
        } else if (!st.error) {
          setNostrPubkey(null);
          setLinkStatus("unlinked");
        }
      } catch {
        // transient failure → stay unknown; do NOT present as unlinked
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity]);

  const handleLink = useCallback(async () => {
    if (!identity) return;
    setBusy(true);
    setError(null);
    try {
      const res = await linkNostr(identity.pubkey, bytesToHex(identity.secretKey));
      if (res.ok) {
        setNostrPubkey(res.nostrPubkey);
        setLinkStatus("linked");
      } else {
        setError(
          res.error === "NO_NIP07"
            ? "No NIP-07 extension detected"
            : (res.error ?? "Link failed"),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [identity]);

  const handleLinkWithNsec = useCallback(async () => {
    if (!identity) return;
    setNsecBusy(true);
    setError(null);
    try {
      const res = await linkNostrWithNsec(
        identity.pubkey,
        bytesToHex(identity.secretKey),
        nsecInput,
      );
      if (res.ok) {
        setNostrPubkey(res.nostrPubkey);
        setLinkStatus("linked");
      } else {
        setError(
          res.error === "NCRYPTSEC_UNSUPPORTED"
            ? "Encrypted keys (ncryptsec) are not supported yet — use the raw nsec."
            : res.error === "INVALID_NSEC"
              ? "That doesn't look like a valid nsec key."
              : (res.error ?? "Link failed"),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setNsecBusy(false);
      setNsecInput("");
    }
  }, [identity, nsecInput]);

  const shortNpub = nostrPubkey
    ? (() => {
        try {
          const npub = hexToNpub(nostrPubkey);
          return npub.length > 20 ? npub.slice(0, 12) + "…" + npub.slice(-8) : npub;
        } catch {
          return nostrPubkey.slice(0, 12) + "…";
        }
      })()
    : "";

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
          bolt
        </span>
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>Nostr identity</h2>
      </div>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
        Link a Nostr key (via a NIP-07 browser extension or a private key) to show a verified
        identity on your listings. Buyers can then reach you on nostr.at.
      </p>

      {linkStatus === "linked" && nostrPubkey ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-block",
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              background: "oklch(92% 0.04 145)",
              color: "oklch(40% 0.10 145)",
            }}
          >
            Nostr verified
          </span>
          <a
            href={nostrAtProfileUrl(nostrPubkey)}
            target="_blank"
            rel="noopener noreferrer"
            title={nostrPubkey}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "inherit",
              textDecoration: "underline dotted",
            }}
          >
            {shortNpub}
          </a>
        </div>
      ) : linkStatus === "unlinked" ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {hasExtension ? (
              <button
                type="button"
                onClick={handleLink}
                disabled={busy}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--fg)",
                  padding: "8px 18px",
                  fontSize: 13,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                {busy ? "Linking…" : "Connect with NIP-07 Extension"}
              </button>
            ) : (
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                No NIP-07 extension detected. Install Alby or another extension — or use the
                private-key input below to link your Nostr identity.
              </p>
            )}
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 16,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              background: "var(--bg)",
            }}
          >
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Connect with Private Key
            </h3>
            <p style={{ fontSize: 12, color: "var(--red)", lineHeight: 1.6, marginBottom: 12 }}>
              WARNING: Pasting nsec is dangerous. This is necessary for now if you want to link
              your Nostr identity on this device. The key is only used to sign the link and is
              never stored.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                type="password"
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
                placeholder="nsec1… or ncryptsec1…"
                aria-label="Nostr private key (nsec)"
                spellCheck={false}
                autoComplete="off"
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: "var(--font-mono)",
                  color: "var(--fg)",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                }}
              />
              <button
                type="button"
                onClick={handleLinkWithNsec}
                disabled={nsecBusy || !nsecInput.trim()}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--fg)",
                  padding: "8px 18px",
                  fontSize: 13,
                  cursor: nsecBusy || !nsecInput.trim() ? "not-allowed" : "pointer",
                }}
              >
                {nsecBusy ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: "var(--red)", marginTop: 12, lineHeight: 1.6 }}>
              {error}
            </p>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Checking Nostr link status…
        </p>
      )}
    </div>
  );
}
