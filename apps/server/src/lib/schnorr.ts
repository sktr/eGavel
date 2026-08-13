import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex.js";

export function secretDigest(secret: string): Uint8Array {
  return sha256(new TextEncoder().encode(secret));
}

export function signSecret(secret: string, privkeyHex: string): string {
  return bytesToHex(schnorr.sign(secretDigest(secret), hexToBytes(privkeyHex)));
}

/** pubkeyHex must be an x-only (32-byte) pubkey. */
export function verifySecretSignature(
  sigHex: string,
  secret: string,
  pubkeyXOnlyHex: string,
): boolean {
  try {
    return schnorr.verify(hexToBytes(sigHex), secretDigest(secret), hexToBytes(pubkeyXOnlyHex));
  } catch {
    return false;
  }
}
