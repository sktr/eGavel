import { describe, it, expect } from "vitest"
import { signSecretHex, buildWitness, swapLockedProof } from "./claim"
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

describe("swapLockedProof", () => {
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
    await expect(swapLockedProof(proof, 100, bytesToHex(sk))).rejects.toThrow()
  })
})
