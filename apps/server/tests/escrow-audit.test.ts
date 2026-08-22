import { describe, it, expect } from "vitest";
import { buildEscrowAuditEvent } from "../src/lib/audit-publish.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../src/lib/hex.js";

describe("buildEscrowAuditEvent", () => {
  it("builds kind 1022 with status + tracking tags and valid id/sig", () => {
    const sk=bytesToHex(schnorr.utils.randomSecretKey());
    const pk=bytesToHex(schnorr.getPublicKey(hexToBytes(sk)));
    const ev=buildEscrowAuditEvent(sk, { auctionId:"a1", status:"shipped", trackingKind:"s10", amount: 100 });
    expect(ev.kind).toBe(1022);
    expect(ev.pubkey).toBe(pk);
    expect(ev.tags).toContainEqual(["e","a1"]);
    expect(ev.tags).toContainEqual(["status","shipped"]);
    expect(ev.tags).toContainEqual(["tracking","s10"]);
    expect(typeof ev.id).toBe("string"); expect(ev.id).toHaveLength(64);
    expect(typeof ev.sig).toBe("string"); expect(ev.sig).toHaveLength(128);
  });
  it("includes fallback_cosign tag when fallback", () => {
    const sk=bytesToHex(schnorr.utils.randomSecretKey());
    const ev=buildEscrowAuditEvent(sk, { auctionId:"a1", status:"shipped", fallbackCosign:true, amount: 100 });
    expect(ev.tags).toContainEqual(["note","fallback_cosign"]);
  });
});
