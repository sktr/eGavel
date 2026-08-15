import { describe, it, expect } from "vitest";
import { shortHex } from "./ident";

describe("shortHex", () => {
  it("shortens a 64-char hex pubkey to first8…last6", () => {
    expect(shortHex("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"))
      .toBe("3bf0c63f…fa459d");
  });
  it("returns short input unchanged", () => {
    expect(shortHex("abc")).toBe("abc");
  });
});
