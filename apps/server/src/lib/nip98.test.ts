import { describe, it, expect } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "./hex.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { verifyNip98Event } from "./nip98.js";

function signEvent(event: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }, sk: Uint8Array) {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(sha256(new TextEncoder().encode(serialized)), sk));
  return { ...event, id, sig };
}

describe("verifyNip98Event", () => {
  it("accepts a validly signed NIP-98 event", () => {
    const sk = schnorr.utils.randomSecretKey();
    const pk = bytesToHex(schnorr.getPublicKey(sk));
    const event = signEvent({ pubkey: pk, created_at: Math.floor(Date.now()/1000), kind: 27235, tags: [["u", "https://egavel.vercel.app"], ["method", "LINK"]], content: "02trading" }, sk);
    const res = verifyNip98Event(event);
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.nostrPubkey).toBe(pk); expect(res.content).toBe("02trading"); }
  });

  it("rejects a validly signed event with a stale created_at", () => {
    const sk = schnorr.utils.randomSecretKey();
    const pk = bytesToHex(schnorr.getPublicKey(sk));
    const event = signEvent({ pubkey: pk, created_at: Math.floor(Date.now()/1000) - 3600, kind: 27235, tags: [], content: "02trading" }, sk);
    const res = verifyNip98Event(event);
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.error).toBe("STALE_EVENT"); }
  });

  it("rejects a validly signed event with a forged id", () => {
    const sk = schnorr.utils.randomSecretKey();
    const pk = bytesToHex(schnorr.getPublicKey(sk));
    const event = signEvent({ pubkey: pk, created_at: Math.floor(Date.now()/1000), kind: 27235, tags: [], content: "02trading" }, sk);
    const forged = { ...event, id: "a".repeat(64) };
    const res = verifyNip98Event(forged);
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.error).toBe("ID_MISMATCH"); }
  });

  it("rejects a tampered event", () => {
    const sk = schnorr.utils.randomSecretKey();
    const pk = bytesToHex(schnorr.getPublicKey(sk));
    const event = signEvent({ pubkey: pk, created_at: Math.floor(Date.now()/1000), kind: 27235, tags: [], content: "02trading" }, sk);
    const tampered = { ...event, content: "02evil" };
    const res = verifyNip98Event(tampered);
    expect(res.ok).toBe(false);
  });

  it("rejects a non-27235 event", () => {
    const sk = schnorr.utils.randomSecretKey();
    const pk = bytesToHex(schnorr.getPublicKey(sk));
    const event = signEvent({ pubkey: pk, created_at: Math.floor(Date.now()/1000), kind: 1, tags: [], content: "02trading" }, sk);
    expect(verifyNip98Event(event).ok).toBe(false);
  });
});
