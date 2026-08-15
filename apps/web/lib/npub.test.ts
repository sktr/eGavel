import { describe, it, expect } from "vitest";
import { hexToNpub, nostrProfileUri, nostrAtProfileUrl } from "./npub";

describe("hexToNpub", () => {
  it("converts a hex pubkey to a bech32 npub", () => {
    // Known vector: nostr-tools test key
    const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    const npub = hexToNpub(hex);
    expect(npub).toBe("npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6");
  });

  it("throws on invalid hex length", () => {
    expect(() => hexToNpub("abc")).toThrow();
    expect(() => hexToNpub("zz".repeat(32))).toThrow();
  });
});

describe("nostrProfileUri (NIP-21)", () => {
  it("builds a nostr:npub1... URI from a hex pubkey", () => {
    const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    expect(nostrProfileUri(hex)).toBe(
      "nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
    );
  });

  it("throws on invalid hex input", () => {
    expect(() => nostrProfileUri("abc")).toThrow();
  });
});

describe("nostrAtProfileUrl (web gateway)", () => {
  it("builds a https://nostr.at/<npub> URL from a hex pubkey", () => {
    const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    expect(nostrAtProfileUrl(hex)).toBe(
      "https://nostr.at/npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
    );
  });

  it("throws on invalid hex input", () => {
    expect(() => nostrAtProfileUrl("abc")).toThrow();
  });
});
