import { describe, it, expect, vi } from "vitest";
import { bech32 } from "@scure/base";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./hex";
import { buildLinkEvent, decodeNsec, linkNostrWithNsec, parseLinkResult, signLinkEventWithNsec } from "./nostr-link";

function makeNsecFixture() {
  const sk = schnorr.utils.randomSecretKey();
  const words = bech32.toWords(sk);
  return { nsec: bech32.encode("nsec", words), hex: bytesToHex(sk) };
}

describe("buildLinkEvent", () => {
  it("builds a NIP-98 event with the trading pubkey as content", () => {
    const event = buildLinkEvent("02trading", 1234567890);
    expect(event.kind).toBe(27235);
    expect(event.content).toBe("02trading");
    expect(event.tags).toContainEqual(["method", "LINK"]);
  });
});

describe("parseLinkResult", () => {
  it("returns ok with nostr pubkey on success", () => {
    expect(parseLinkResult({ ok: true, nostr_pubkey: "03nostr" })).toEqual({ ok: true, nostrPubkey: "03nostr" });
  });
  it("propagates server errors", () => {
    expect(parseLinkResult({ error: "BAD_SIGNATURE" })).toEqual({ ok: false, error: "BAD_SIGNATURE" });
  });
});

describe("decodeNsec", () => {
  it("decodes a valid nsec to a 64-hex secret key", () => {
    const { nsec, hex } = makeNsecFixture();
    expect(decodeNsec(nsec)).toBe(hex);
  });
  it("rejects garbage and ncryptsec with clear errors", () => {
    expect(() => decodeNsec("garbage")).toThrow();
    expect(() => decodeNsec("ncryptsec1...")).toThrow(/ncryptsec/i);
  });
});

describe("signLinkEventWithNsec", () => {
  it("produces a NIP-98 event whose sig verifies against the nsec-derived pubkey", async () => {
    const { hex } = makeNsecFixture();
    const tradingPubkey = "02" + "a".repeat(62);
    const base = buildLinkEvent(tradingPubkey);
    const signed = await signLinkEventWithNsec(
      { created_at: base.created_at, kind: base.kind, tags: base.tags, content: base.content },
      hex,
    );
    const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(hex)));
    expect(signed.pubkey).toBe(pubkey);
    expect(signed.content).toBe(tradingPubkey);
    const serialized = JSON.stringify([0, signed.pubkey, signed.created_at, signed.kind, signed.tags, signed.content]);
    const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
    expect(signed.id).toBe(id);
    const ok = schnorr.verify(hexToBytes(signed.sig), hexToBytes(id), hexToBytes(signed.pubkey));
    expect(ok).toBe(true);
  });
});

describe("linkNostrWithNsec", () => {
  it("POSTs a NIP-98 event signed with the nsec (no extension)", async () => {
    const { nsec, hex } = makeNsecFixture();
    const tradingPubkey = "02" + "b".repeat(62);
    const tradingSkHex = bytesToHex(schnorr.utils.randomSecretKey());
    const nostrPubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(hex)));

    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(url).toContain("/identity/nostr-link");
      expect(body.trading_pubkey).toBe(tradingPubkey);
      expect(body.sig).toMatch(/^[0-9a-f]{128}$/);
      const event = body.event;
      expect(event.kind).toBe(27235);
      expect(event.content).toBe(tradingPubkey);
      expect(event.pubkey).toBe(nostrPubkey);
      const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
      const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
      const valid = schnorr.verify(hexToBytes(event.sig), hexToBytes(id), hexToBytes(event.pubkey));
      expect(valid).toBe(true);
      return new Response(JSON.stringify({ ok: true, nostr_pubkey: nostrPubkey }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await linkNostrWithNsec(tradingPubkey, tradingSkHex, nsec);
    expect(res).toEqual({ ok: true, nostrPubkey });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
