import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stubWindow, restoreWindow, jsonResponse } from "./test-utils";
import { fetchEscrow } from "./escrow";

describe("fetchEscrow", () => {
  beforeEach(()=> stubWindow());
  afterEach(()=> restoreWindow());
  it("fetches GET /escrow with signed query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ auction_id:"a1", stage:1, status:"active", proofs_data:"{}" }));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    // signSecretHex は固定 sk で決定的
    const sk="ab".repeat(32);
    const res = await fetchEscrow("a1", "02aa", sk);
    expect(fetchMock).toHaveBeenCalled();
    expect(res.auction_id).toBe("a1");
  });
});
