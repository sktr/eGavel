import { describe, it, expect, beforeEach } from "vitest";
import { initDb, type Db } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { signSecret } from "../src/lib/schnorr.js";
import { sellerKey } from "./helpers.js";

describe("NUT-18 wallet receive (POST /wallet/receive + GET /wallet/receive)", () => {
  let db: Db;
  const SERVER = "04server";

  beforeEach(() => {
    db = initDb();
  });

  function proof(secret: string, amount: number) {
    return { id: "ks1", amount, secret, C: "02".padEnd(64, "c") };
  }

  it("stores a posted payment and the receiver collects it once (signed)", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const receiver = sellerKey();
    const mint = "https://mint.example";

    // Payer POSTs a NUT-18 payment (id = receiver's trading pubkey).
    const post = await app.request("http://localhost/api/wallet/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: receiver.pubkey,
        mint,
        unit: "sat",
        proofs: [proof("s1", 10), proof("s2", 20)],
        memo: "test",
      }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true, amount: 30 });

    // Receiver (signed) collects the pending proofs.
    const sig = signSecret(`wallet-receive:${receiver.pubkey}`, receiver.skHex);
    const get = await app.request(
      `http://localhost/api/wallet/receive?receiver_pubkey=${receiver.pubkey}&sig=${sig}`,
    );
    expect(get.status).toBe(200);
    const body = (await get.json()) as {
      receipts: Array<{ rid: number; mint_url: string; proofs: string; amount: number }>;
    };
    expect(body.receipts).toHaveLength(1);
    const rid = body.receipts[0]!.rid;
    expect(typeof rid).toBe("number");
    expect(body.receipts[0]!.mint_url).toBe(mint);
    expect(body.receipts[0]!.amount).toBe(30);
    expect(JSON.parse(body.receipts[0]!.proofs)).toHaveLength(2);

    // Read-only: a second GET still returns the receipt until it is ACKed
    // (the old clear-on-read semantics silently destroyed proofs when the
    // client-side wallet.store failed after fetching).
    const get2 = await app.request(
      `http://localhost/api/wallet/receive?receiver_pubkey=${receiver.pubkey}&sig=${sig}`,
    );
    const again = (await get2.json()) as { receipts: Array<{ rid: number }> };
    expect(again.receipts).toHaveLength(1);

    // Ack (signed) removes exactly the acknowledged rows.
    const ackSig = signSecret(`wallet-receive-ack:${receiver.pubkey}`, receiver.skHex);
    const ack = await app.request("http://localhost/api/wallet/receive/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiver_pubkey: receiver.pubkey,
        sig: ackSig,
        rowids: [rid],
      }),
    });
    expect(ack.status).toBe(200);

    // Third collect returns nothing (acked).
    const get3 = await app.request(
      `http://localhost/api/wallet/receive?receiver_pubkey=${receiver.pubkey}&sig=${sig}`,
    );
    expect((await get3.json()) as { receipts: unknown[] }).toEqual({ ok: true, receipts: [] });
  });

  it("ack only deletes rows owned by the signing receiver", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const alice = sellerKey();
    const bob = sellerKey();
    await db.savePendingReceive(alice.pubkey, "https://mint.example", JSON.stringify([proof("a1", 5)]), 5);
    await db.savePendingReceive(bob.pubkey, "https://mint.example", JSON.stringify([proof("b1", 7)]), 7);

    // Bob's rowid discovered via his own signed read.
    const bobSig = signSecret(`wallet-receive:${bob.pubkey}`, bob.skHex);
    const bobGet = await app.request(
      `http://localhost/api/wallet/receive?receiver_pubkey=${bob.pubkey}&sig=${bobSig}`,
    );
    const bobBody = (await bobGet.json()) as { receipts: Array<{ rid: number }> };
    const bobRid = bobBody.receipts[0]!.rid;

    // Alice tries to ack Bob's rowid — must be ignored.
    const ackSig = signSecret(`wallet-receive-ack:${alice.pubkey}`, alice.skHex);
    const ack = await app.request("http://localhost/api/wallet/receive/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiver_pubkey: alice.pubkey, sig: ackSig, rowids: [bobRid] }),
    });
    expect(ack.status).toBe(200);

    // Bob's receipt survived; Alice can still see hers.
    const bobAgain = await app.request(
      `http://localhost/api/wallet/receive?receiver_pubkey=${bob.pubkey}&sig=${bobSig}`,
    );
    expect(((await bobAgain.json()) as { receipts: unknown[] }).receipts).toHaveLength(1);
    const aliceSig = signSecret(`wallet-receive:${alice.pubkey}`, alice.skHex);
    const aliceGet = await app.request(
      `http://localhost/api/wallet/receive?receiver_pubkey=${alice.pubkey}&sig=${aliceSig}`,
    );
    expect(((await aliceGet.json()) as { receipts: unknown[] }).receipts).toHaveLength(1);
  });

  it("rejects a forged ACK signature", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const receiver = sellerKey();
    await db.savePendingReceive(receiver.pubkey, "https://mint.example", JSON.stringify([proof("s1", 5)]), 5);

    const forged = signSecret(`wallet-receive-ack:${receiver.pubkey}`, "11".repeat(32));
    const res = await app.request("http://localhost/api/wallet/receive/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiver_pubkey: receiver.pubkey, sig: forged, rowids: [1] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a forged collector signature", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const receiver = sellerKey();
    await db.savePendingReceive(receiver.pubkey, "https://mint.example", JSON.stringify([proof("s1", 5)]), 5);

    const forged = signSecret(`wallet-receive:${receiver.pubkey}`, "11".repeat(32));
    const get = await app.request(
      `http://localhost/api/wallet/receive?receiver_pubkey=${receiver.pubkey}&sig=${forged}`,
    );
    expect(get.status).toBe(400);
  });

  it("accepts proofs whose amount is a string (wallet toJSON serialization)", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const receiver = sellerKey();

    // Some wallets serialize Proof.amount via its toJSON() as "10" (string).
    const post = await app.request("http://localhost/api/wallet/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: receiver.pubkey,
        mint: "https://mint.example",
        proofs: [{ id: "ks1", amount: "10", secret: "s-str", C: "02".padEnd(64, "d") }],
      }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true, amount: 10 });
  });

  it("rejects an empty/invalid payment payload", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const bad = await app.request("http://localhost/api/wallet/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x", mint: "m", proofs: [] }),
    });
    expect(bad.status).toBe(400);
  });

  it("dedupes proofs already stored for the same receiver + mint", async () => {
    const app = createApp(db, { serverKey: SERVER });
    const receiver = sellerKey();
    await db.savePendingReceive(receiver.pubkey, "https://mint.example", JSON.stringify([proof("s1", 10)]), 10);

    // Same secret posted again → no duplicate row.
    const post = await app.request("http://localhost/api/wallet/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: receiver.pubkey, mint: "https://mint.example", proofs: [proof("s1", 10)] }),
    });
    expect((await post.json()) as { amount: number }).toEqual({ ok: true, amount: 10 });

    const sig = signSecret(`wallet-receive:${receiver.pubkey}`, receiver.skHex);
    const get = await app.request(
      `http://localhost/api/wallet/receive?receiver_pubkey=${receiver.pubkey}&sig=${sig}`,
    );
    const body = (await get.json()) as { receipts: Array<{ proofs: string }> };
    expect(body.receipts).toHaveLength(1);
    expect(JSON.parse(body.receipts[0]!.proofs)).toHaveLength(1); // deduped
  });
});
