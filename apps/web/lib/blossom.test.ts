import { describe, it, expect, vi } from "vitest"
import { uploadToBlossom } from "./blossom"

function fakeSigner(pubkey = "a".repeat(64)) {
  return {
    getPublicKey: async () => pubkey,
    signEvent: async (t: any) => ({ ...t, id: "x", pubkey, sig: "s", kind: 24242 }),
  } as any
}

describe("uploadToBlossom", () => {
  it("PUTs to /upload with Nostr auth and returns url", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ url: "https://blossom.primal.net/abc.jpg", sha256: "a".repeat(64), size: 123 }), { status: 200, headers: { "content-type": "application/json" } }) as any)
    const file = new File(["hello"], "hello.jpg", { type: "image/jpeg" })
    const res = await uploadToBlossom(file, fakeSigner(), "https://blossom.primal.net")
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/upload"), expect.objectContaining({ method: "PUT" }))
    expect(res.url).toContain("https://blossom.primal.net")
    fetchSpy.mockRestore()
  })
})
