import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { signSecretHex, buildWitness, swapLockedProofs, collectChange } from "./claim"
import { schnorr } from "@noble/curves/secp256k1.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { generateSecretKey, getPublicKey } from "nostr-tools"
import { bytesToHex, hexToBytes } from "nostr-tools/utils"
import type { Proof } from "@cashu/cashu-ts"

describe("claim signing", () => {
  it("signSecretHex produces a Schnorr signature verifiable against the x-only pubkey", () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk) // x-only
    const secret = '["P2PK",{"nonce":"n","data":"02dead"}]'
    const sig = signSecretHex(secret, bytesToHex(sk))
    const digest = sha256(new TextEncoder().encode(secret))
    expect(schnorr.verify(hexToBytes(sig), digest, hexToBytes(pk))).toBe(true)
  })

  it("buildWitness merges seller and server signatures into a proof witness", () => {
    const proof = { id: "ks1", amount: 100, secret: "s", C: "c" }
    const result = buildWitness(proof, ["sig-a", "sig-b"])
    expect(result.witness).toContain("sig-a")
    expect(result.witness).toContain("sig-b")
    expect(JSON.parse(result.witness as string).signatures).toEqual(["sig-a", "sig-b"])
  })
})

describe("collectChange (proxy-bidding excess return)", () => {
  const changeBody = {
    proofs: [
      { keyset_id: "ks1", C: "c1", secret: "s1", amount: 200 },
      { keyset_id: "ks1", C: "c2", secret: "s2", amount: 50 },
    ],
    amount: 250,
    mint_url: "https://mint.example",
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(changeBody), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it("stores the returned change proofs into the wallet store", async () => {
    const result = await collectChange("a1", "03cafebabe")

    expect(result.amount).toBe(250)
    expect(result.mint_url).toBe("https://mint.example")

    const raw = localStorage.getItem("cashu-wallet-v1")!
    expect(raw).toBeTruthy()
    const store = JSON.parse(raw) as Record<string, string[]>
    expect(store["https://mint.example"]).toHaveLength(2)
  })

  it("propagates NO_CHANGE from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "NO_CHANGE" }), { status: 400, headers: { "Content-Type": "application/json" } }),
      ),
    )
    await expect(collectChange("a1", "03cafebabe")).rejects.toThrow("NO_CHANGE")
  })
})

describe("swapLockedProofs", () => {
  it("throws with a clear error when the mint is unreachable", async () => {
    const proof = {
      id: "ks1",
      amount: 100,
      secret: "s",
      C: "c",
      mint_url: "https://127.0.0.1:1",
      witness: "",
    } as unknown as Proof
    const sk = generateSecretKey()
    await expect(swapLockedProofs([proof], 100, bytesToHex(sk))).rejects.toThrow()
  })
})
