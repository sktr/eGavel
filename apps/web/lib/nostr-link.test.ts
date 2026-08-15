import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildLinkEvent, parseLinkResult } from "./nostr-link";

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
