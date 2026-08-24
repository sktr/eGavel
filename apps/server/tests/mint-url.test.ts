import { describe, it, expect } from "vitest";
import { isValidMintUrl } from "../src/lib/mint-url.js";

describe("isValidMintUrl — SSRF guard", () => {
  it("accepts https mint URLs with a public hostname", () => {
    expect(isValidMintUrl("https://mint.example")).toBe(true);
    expect(isValidMintUrl("https://mint.minibits.cash/Bitcoin")).toBe(true);
    expect(isValidMintUrl("https://testnut.cashu.space")).toBe(true);
  });

  it("rejects non-https schemes", () => {
    expect(isValidMintUrl("http://mint.example")).toBe(false);
    expect(isValidMintUrl("ftp://mint.example")).toBe(false);
    expect(isValidMintUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects private and loopback IP addresses", () => {
    expect(isValidMintUrl("https://127.0.0.1")).toBe(false);
    expect(isValidMintUrl("https://10.0.0.1")).toBe(false);
    expect(isValidMintUrl("https://192.168.1.1")).toBe(false);
    expect(isValidMintUrl("https://172.16.0.1")).toBe(false);
    expect(isValidMintUrl("https://169.254.169.254")).toBe(false);
    expect(isValidMintUrl("https://0.0.0.0")).toBe(false);
    expect(isValidMintUrl("https://[::1]")).toBe(false);
    expect(isValidMintUrl("https://[fc00::1]")).toBe(false);
  });

  it("rejects localhost and metadata-style hostnames", () => {
    expect(isValidMintUrl("https://localhost")).toBe(false);
    expect(isValidMintUrl("https://localhost:3000")).toBe(false);
  });

  it("rejects garbage strings and missing URLs", () => {
    expect(isValidMintUrl("")).toBe(false);
    expect(isValidMintUrl("not a url")).toBe(false);
    expect(isValidMintUrl("https://")).toBe(false);
  });

  it("rejects non-https pseudo-schemes (dev-only test://local mint was removed)", () => {
    expect(isValidMintUrl("test://local")).toBe(false);
    expect(isValidMintUrl("data:text/plain,hi")).toBe(false);
  });
});
