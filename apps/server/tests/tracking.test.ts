// apps/server/tests/tracking.test.ts
import { describe, it, expect } from "vitest";
import { validateTracking } from "../src/lib/tracking.js";

describe("validateTracking", () => {
  // UPU 公式例: serial 47312482 -> check 9 => "EE473124829US" などが valid
  it("accepts valid S10 with correct check digit (UPU official example)", () => {
    expect(validateTracking("EE473124829US")).toEqual({ kind: "s10" });
    expect(validateTracking("AG018300045CN")).toEqual({ kind: "s10" }); // s10.wiki 例 01830004->5
    expect(validateTracking("RR287043775IN")).toEqual({ kind: "s10" }); // Wikipedia 例
  });
  it("accepts lower-case S10 (case-insensitive)", () => {
    expect(validateTracking("ee473124829us")).toEqual({ kind: "s10" });
  });
  it("rejects S10 with wrong check digit", () => {
    expect(validateTracking("EE473124820US")).toBeNull(); // last digit 0 は不正
    expect(validateTracking("AG018300044CN")).toBeNull();
  });
  it("rejects S10 with wrong length / non-digit serial", () => {
    expect(validateTracking("EE47312482US")).toBeNull(); // 12 chars
    expect(validateTracking("EE4731248291US")).toBeNull();
    expect(validateTracking("EE47A124829US")).toBeNull();
  });
  it("accepts UPS 1Z + 16 chars (18 total)", () => {
    expect(validateTracking("1Z999AA10123456784")).toEqual({ kind: "ups" });
    expect(validateTracking("1Z999AA1012345678")).toBeNull(); // 17 chars
  });
  it("accepts FedEx 12 or 15 digits", () => {
    expect(validateTracking("123456789012")).toEqual({ kind: "fedex" });
    expect(validateTracking("123456789012345")).toEqual({ kind: "fedex" });
    expect(validateTracking("12345678901")).toBeNull();
  });
  it("accepts DHL 10 digits", () => {
    expect(validateTracking("1234567890")).toEqual({ kind: "dhl" });
    // 10桁は DHL 優先、12桁は FedEx — DHL は 10 固定
    expect(validateTracking("1234567890")).toEqual({ kind: "dhl" });
  });
  it("rejects empty / garbage", () => {
    expect(validateTracking("")).toBeNull();
    expect(validateTracking("hello")).toBeNull();
    expect(validateTracking("1Z")).toBeNull();
  });
  it("trims whitespace", () => {
    expect(validateTracking("  EE473124829US  ")).toEqual({ kind: "s10" });
  });
});
