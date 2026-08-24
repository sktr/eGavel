import { describe, it, expect, vi } from "vitest";
import { fetchEscrow } from "./escrow";

vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ auction_id: "a1", shipped: 0, created_at: 123, proofs_data: "{}", timeout_expired: false }),
}));

describe("fetchEscrow", () => {
  it("fetches GET /escrow with signed query", async () => {
    const res = await fetchEscrow("a1", "02aa".padEnd(64, "0"), "ab".repeat(32));
    expect(res.auction_id).toBe("a1");
    expect(res.shipped).toBe(0);
  });
});
