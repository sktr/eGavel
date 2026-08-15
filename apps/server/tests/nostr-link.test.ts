import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "../src/lib/hex.js";
import { initDb, type Db } from "../src/db/index.js";
import { createAuctionRoutes } from "../src/routes/auctions.js";
import { signSecret } from "../src/lib/schnorr.js";

/** NIP-01 event signing: id = sha256(serialized array), sig signs that digest. */
function signEvent(event: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }, sk: Uint8Array) {
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(sha256(new TextEncoder().encode(serialized)), sk));
  return { ...event, id, sig };
}

describe("POST/DELETE /api/identity/nostr-link", async () => {
  let db: Db;
  let app: Hono;
  let tradingSk: Uint8Array;
  let tradingPubkey: string;
  let nostrSk: Uint8Array;
  let nostrPubkey: string;

  beforeEach(async () => {
    db = initDb();
    app = new Hono();
    app.route("/api", createAuctionRoutes(db));
    tradingSk = schnorr.utils.randomSecretKey();
    tradingPubkey = bytesToHex(schnorr.getPublicKey(tradingSk));
    nostrSk = schnorr.utils.randomSecretKey();
    nostrPubkey = bytesToHex(schnorr.getPublicKey(nostrSk));
  });

  function linkBody(overrides: Record<string, unknown> = {}) {
    const event = signEvent(
      {
        pubkey: nostrPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 27235,
        tags: [["u", "https://egavel.vercel.app"], ["method", "LINK"]],
        content: tradingPubkey,
      },
      nostrSk,
    );
    return {
      trading_pubkey: tradingPubkey,
      sig: signSecret(`link:${tradingPubkey}`, bytesToHex(tradingSk)),
      event,
      ...overrides,
    };
  }

  it("stores the link when the event and trading sig are valid", async () => {
    const res = await app.request("http://localhost/api/identity/nostr-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(linkBody()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; nostr_pubkey: string };
    expect(body.ok).toBe(true);
    expect(body.nostr_pubkey).toBe(nostrPubkey);
    expect(await db.getNostrLink(tradingPubkey)).toEqual({ nostr_pubkey: nostrPubkey });
  });

  it("rejects when the event content does not match the trading pubkey (CONTENT_MISMATCH)", async () => {
    const res = await app.request("http://localhost/api/identity/nostr-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        linkBody({ event: signEvent({ pubkey: nostrPubkey, created_at: Math.floor(Date.now() / 1000), kind: 27235, tags: [], content: "02someone-else" }, nostrSk) }),
      ),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("CONTENT_MISMATCH");
    expect(await db.getNostrLink(tradingPubkey)).toBeNull();
  });

  it("rejects a tampered event (BAD_SIGNATURE)", async () => {
    const event = signEvent(
      { pubkey: nostrPubkey, created_at: Math.floor(Date.now() / 1000), kind: 27235, tags: [], content: tradingPubkey },
      nostrSk,
    );
    const tampered = {
      ...event,
      content: "02evil",
      id: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, "02evil"])))),
    };
    const res = await app.request("http://localhost/api/identity/nostr-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        linkBody({ event: tampered }),
      ),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("BAD_SIGNATURE");
    expect(await db.getNostrLink(tradingPubkey)).toBeNull();
  });

  it("rejects a bad trading-key signature (INVALID_SIGNATURE)", async () => {
    const res = await app.request("http://localhost/api/identity/nostr-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        linkBody({ sig: "deadbeef" }),
      ),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
    expect(await db.getNostrLink(tradingPubkey)).toBeNull();
  });

  it("DELETE removes the link with a valid unlink signature", async () => {
    await db.saveNostrLink(tradingPubkey, nostrPubkey);
    const res = await app.request("http://localhost/api/identity/nostr-link", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trading_pubkey: tradingPubkey,
        sig: signSecret(`unlink:${tradingPubkey}`, bytesToHex(tradingSk)),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(await db.getNostrLink(tradingPubkey)).toBeNull();
  });

  it("DELETE rejects a signature from a different trading key", async () => {
    await db.saveNostrLink(tradingPubkey, nostrPubkey);
    const otherSk = schnorr.utils.randomSecretKey();
    const res = await app.request("http://localhost/api/identity/nostr-link", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trading_pubkey: tradingPubkey,
        sig: signSecret(`unlink:${tradingPubkey}`, bytesToHex(otherSk)),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SIGNATURE");
    expect(await db.getNostrLink(tradingPubkey)).toEqual({ nostr_pubkey: nostrPubkey });
  });
});
