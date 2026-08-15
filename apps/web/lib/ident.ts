/** Short hex identifier for the TRADING key — never an npub, so it is not
 * mistaken for a real Nostr identity. Full hex is available via title/copy. */
export function shortHex(hexPubkey: string): string {
  return hexPubkey.length > 16
    ? hexPubkey.slice(0, 8) + "…" + hexPubkey.slice(-6)
    : hexPubkey;
}
