"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "../lib/identity";
import { bytesToHex } from "../lib/hex";
import { hexToNpub, nostrAtProfileUrl } from "../lib/npub";
import {
  detectNostrExtension,
  fetchNostrLinkStatus,
  linkNostr,
  unlinkNostr,
} from "../lib/nostr-link";

/**
 * Link Nostr (NIP-07): binds the account's trading key to a Nostr pubkey via
 * the user's browser extension (Alby, nos2x, ...). A linked seller shows a
 * "Nostr verified" badge on their listings so buyers can reach them on
 * nostr.at.
 *
 * No extension installed → explanatory text (the link is impossible without
 * NIP-07, since proving the Nostr key requires the extension to sign).
 */
export function IdentityNostrSection() {
  const { identity } = useIdentity();
  const [hasExtension, setHasExtension] = useState(false);
  const [nostrPubkey, setNostrPubkey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHasExtension(detectNostrExtension());
    if (!identity) return;
    let cancelled = false;
    (async () => {
      const st = await fetchNostrLinkStatus(
        identity.pubkey,
        bytesToHex(identity.secretKey),
      );
      if (cancelled) return;
      if (st.ok && st.nostrPubkey) setNostrPubkey(st.nostrPubkey);
    })().catch(() => {});
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

  const handleUnlink = useCallback(async () => {
    if (!identity) return;
    setBusy(true);
    setError(null);
    try {
      const res = await unlinkNostr(identity.pubkey, bytesToHex(identity.secretKey));
      if (res.ok) {
        setNostrPubkey(null);
      } else {
        setError(res.error ?? "Unlink failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [identity]);

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
        Link a Nostr key (via a NIP-07 browser extension) to show a verified identity on your
        listings. Buyers can then reach you on nostr.at.
      </p>

      {!hasExtension ? (
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Install Alby or another NIP-07 extension to link your Nostr identity.
        </p>
      ) : nostrPubkey ? (
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
          <button
            type="button"
            onClick={handleUnlink}
            disabled={busy}
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--red)",
              padding: "6px 14px",
              fontSize: 13,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Unlinking…" : "Unlink"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
            {busy ? "Linking…" : "Link Nostr"}
          </button>
          {error && <span style={{ fontSize: 12, color: "var(--red)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
