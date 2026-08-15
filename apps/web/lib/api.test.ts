import { describe, it, expect } from "vitest";
import { apiUrl, rootUrl } from "./api";

describe("apiUrl (builds a full /api/* URL from a root base)", () => {
  it("prefixes /api when the base is a bare root", () => {
    expect(apiUrl("/auctions", "http://localhost:3001")).toBe(
      "http://localhost:3001/api/auctions",
    );
  });

  it("accepts a path without a leading slash", () => {
    expect(apiUrl("auctions", "http://localhost:3001")).toBe(
      "http://localhost:3001/api/auctions",
    );
  });

  it("strips a trailing /api from the base instead of double-prefixing", () => {
    expect(apiUrl("/auctions", "http://localhost:3001/api")).toBe(
      "http://localhost:3001/api/auctions",
    );
  });

  it("strips a trailing slash from the base", () => {
    expect(apiUrl("/auctions", "http://localhost:3001/")).toBe(
      "http://localhost:3001/api/auctions",
    );
  });

  it("builds nested paths with query strings", () => {
    expect(apiUrl("/auctions/a1/change?bidder_pubkey=03me", "https://api.example.com")).toBe(
      "https://api.example.com/api/auctions/a1/change?bidder_pubkey=03me",
    );
  });

  it("preserves the path when it already starts with /api", () => {
    expect(apiUrl("/api/auctions", "http://localhost:3001")).toBe(
      "http://localhost:3001/api/auctions",
    );
  });
});

describe("rootUrl (for endpoints mounted at the root, e.g. /health)", () => {
  it("does not add the /api prefix", () => {
    expect(rootUrl("/health", "http://localhost:3001")).toBe("http://localhost:3001/health");
  });

  it("still normalizes the base", () => {
    expect(rootUrl("/health", "http://localhost:3001/api/")).toBe(
      "http://localhost:3001/health",
    );
  });
});
