import { bech32 } from "@scure/base";

/** Convert a 64-char hex pubkey (x-only) to a bech32 npub string.
 * The account key is derived at m/44'/1237'/0'/0/0 (NIP-06 path), so the
 * hex pubkey already IS a Nostr pubkey — this is pure encoding, no relay. */
export function hexToNpub(hexPubkey: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(hexPubkey)) {
    throw new Error("INVALID_PUBKEY");
  }
  // Manual hex → bytes: no Buffer dependency (runs in the browser).
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hexPubkey.slice(i * 2, i * 2 + 2), 16);
  }
  return bech32.encode("npub", bech32.toWords(bytes), false);
}

/** NIP-21 `nostr:` URI for a profile — opens the user's default Nostr client
 * (damus, Amethyst, Primal, ...) at that profile. */
export function nostrProfileUri(hexPubkey: string): string {
  return `nostr:${hexToNpub(hexPubkey)}`;
}
