/**
 * Shared test helpers for the server suite.
 *
 * vitest picks up `tests/*.test.ts`; this file (no `.test.ts` suffix) is not
 * collected as a test file itself.
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";

/** Build a real secp256k1 keypair for signed requests (e.g. DELETE /auctions,
 * winner-view reads). The bare-hex constants used as stub pubkeys cannot
 * produce verifiable Schnorr signatures, so tests that sign need a real key. */
export function sellerKey(): { skHex: string; pubkey: string } {
  const skHex = bytesToHex(schnorr.utils.randomSecretKey());
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(skHex)));
  return { skHex, pubkey };
}
