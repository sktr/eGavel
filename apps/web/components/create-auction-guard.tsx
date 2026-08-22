"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "../lib/identity";
import { fetchNostrLinkStatus } from "../lib/nostr-link";
import { bytesToHex } from "../lib/hex";
import { IdentityNostrSection } from "../app/identity-nostr-section";
import { ConnectDialog } from "./connect-dialog";

type Props = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function CreateAuctionGuard({ children, className, style }: Props) {
  const router = useRouter();
  const { identity, isLoaded, login, restore } = useIdentity();
  const [checking, setChecking] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const checkAndNavigate = useCallback(async () => {
    if (!isLoaded) return;
    if (!identity) {
      setShowConnect(true);
      return;
    }
    setChecking(true);
    try {
      const st = await fetchNostrLinkStatus(identity.pubkey, bytesToHex(identity.secretKey));
      if (st.ok && st.nostrPubkey) {
        router.push("/create");
      } else {
        setShowLinkModal(true);
      }
    } catch {
      // transient failure — treat as not linked and show modal
      setShowLinkModal(true);
    } finally {
      setChecking(false);
    }
  }, [identity, isLoaded, router]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    void checkAndNavigate();
  };

  // After successful link, navigate to create
  const handleLinked = () => {
    setShowLinkModal(false);
    router.push("/create");
  };

  return (
    <>
      <a
        href="/create"
        onClick={handleClick}
        className={className}
        style={style}
        aria-busy={checking}
      >
        {checking ? "Checking…" : children}
      </a>

      {showLinkModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLinkModal(false);
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius-lg)",
              width: 520,
              maxWidth: "95vw",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 24px 80px rgba(0,0,0,0.12)",
              padding: 24,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>Link Nostr to list</h2>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                style={{
                  width: 28,
                  height: 28,
                  border: "none",
                  background: "var(--bg)",
                  borderRadius: "50%",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--muted)",
                }}
                aria-label="Close"
              >
                <span className="material-icons" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
              Listing requires a linked Nostr identity — it&apos;s how buyers reach you and how your
              listing is mirrored to Nostr (kind 30402). Link it here to continue to the create form.
            </p>
            <IdentityNostrSection compact onLinked={handleLinked} />
          </div>
        </div>
      )}

      {showConnect && (
        <ConnectDialog
          onUseDevice={() => {
            setShowConnect(false);
            login();
          }}
          onRestore={(input) => {
            const res = restore(input);
            if (res.ok) setShowConnect(false);
            return res;
          }}
          onClose={() => setShowConnect(false)}
        />
      )}
    </>
  );
}
