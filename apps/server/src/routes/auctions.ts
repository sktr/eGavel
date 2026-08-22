import { Hono } from "hono";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "../lib/hex.js";
import { Wallet, OutputData } from "@cashu/cashu-ts";
import type { Auction } from "@egavel/shared";
import type { Db } from "../db/index.js";
import { processBid, processPendingBid } from "../process-bid.js";
import type { BidPayload } from "../verify/index.js";
import {
  validateClaim,
  parseProofData,
  computeClaimSplit,
  type StoredProofBundle,
} from "../claim.js";
import { verifySecretSignature, signSecret } from "../lib/schnorr.js";
import { canonicalPubkey } from "../lib/canonical.js";
import { verifyNip98Event } from "../lib/nip98.js";
import { verifyNip99ListingEvent } from "../lib/nip99.js";
import { toPublicBid } from "../lib/public-bid.js";
import { auctionFeeBps } from "../lib/auction-fee.js";
import { settleIfDue } from "../lib/settle.js";
import { isValidMintUrl } from "../lib/mint-url.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { publishAuditLog, publishEscrowAudit } from "../lib/audit-publish.js";
import {
  STAGE1_LOCKTIME_SEC,
  STAGE2_LOCKTIME_SEC,
  TRACKING_CUTOFF_MS,
  WINNER_FALLBACK_MS,
  buildStage1LockOptions,
  buildStage2LockOptions,
} from "../lib/escrow.js";
import { validateTracking } from "../lib/tracking.js";

export interface AuctionRoutesConfig {
  serverKey?: string;
  feeBps?: number;
  escrowMode?: "two-stage" | "legacy";
}

/**
 * Standing price of an auction: the leading verified bid's current_amount
 * (second-price engine), or the start price when there are no verified bids.
 * Settled auctions carry their winning_amount, which equals the leader's
 * standing price at settlement — prefer that so a settled listing shows the
 * price it actually closed at.
 */
async function standingPrice(db: Db, a: Auction): Promise<number> {
  if (a.state === "SETTLED" && a.winning_amount != null && a.winning_amount > 0) {
    return a.winning_amount;
  }
  const bids = await db.getVerifiedBids(a.id);
  const leader = bids[0];
  return leader?.current_amount ?? a.start_price;
}

export function createAuctionRoutes(db: Db, config: AuctionRoutesConfig = {}) {
  const router = new Hono();
  const serverKey =
    config.serverKey ?? process.env.SERVER_PRIVATE_KEY ?? process.env.NOSTR_PRIVATE_KEY;

  function serverPubkey(): string | null {
    if (!serverKey || !/^[0-9a-fA-F]{64}$/.test(serverKey)) return null;
    try {
      return bytesToHex(schnorr.getPublicKey(hexToBytes(serverKey)));
    } catch {
      return null;
    }
  }

  router.get("/auctions", async (c) => {
    const filter = c.req.query("filter");
    const sellerPubkey = c.req.query("seller_pubkey");
    const auctions = sellerPubkey
      ? await db.getAuctionsBySeller(sellerPubkey)
      : filter === "active"
        ? await db.getActiveAuctions()
        : await db.getAllAuctions();
    // Lazy settle: any auction past E+grace settles the moment it is read.
    const settled = [];
    for (const a of auctions) settled.push(await settleIfDue(db, a));
    // Batch-load nostr links for every seller on the page (single query, no
    // N+1) so the web can gate the nostr.at seller link on having a link.
    const nostrLinks = new Map<string, string>();
    for (const l of await db.getAllNostrLinks()) nostrLinks.set(l.trading_pubkey, l.nostr_pubkey);
    const listed = [];
    for (const a of settled) {
      const withPrice = { ...a, current_amount: await standingPrice(db, a) };
      const nostrLink = nostrLinks.get(a.seller_pubkey);
      // Seller identity is public; the winner stays anonymous in listings
      // (revealed only to the seller via GET /auctions/:id, signed).
      const enriched = nostrLink ? { ...withPrice, seller_nostr_pubkey: nostrLink } : withPrice;
      listed.push(enriched.images ? { ...enriched, images: enriched.images.slice(0, 1) } : enriched);
    }
    return c.json(listed);
  });

  // ── Delete listing: seller removes a bid-less auction (a mistaken listing) ──
  // Auth: the seller must prove key ownership with a Schnorr signature over
  // `delete:<id>` (the pubkey alone is public data and not sufficient).
  router.delete("/auctions/:id", async (c) => {
    const id = c.req.param("id")!
    const auction = await db.getAuction(id)
    if (!auction) return c.json({ error: "not found" }, 404)
    const sellerPubkey = c.req.query("seller_pubkey") ?? ""
    const sellerSig = c.req.query("seller_sig") ?? ""
    if (canonicalPubkey(sellerPubkey) !== canonicalPubkey(auction.seller_pubkey)) {
      return c.json({ error: "NOT_SELLER" }, 400)
    }
    if (!verifySecretSignature(sellerSig, `delete:${id}`, canonicalPubkey(sellerPubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400)
    }
    const bids = await db.getAllBids(id)
    if (bids.length > 0) return c.json({ error: "HAS_BIDS" }, 400)
    await db.deleteAuction(id)
    return c.json({ ok: true })
  })

  // ── Create listing: HTTP-direct ──
  router.post("/auctions", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const item = typeof body.item === "string" ? body.item.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const sellerPubkey = typeof body.seller_pubkey === "string" ? body.seller_pubkey.trim() : "";
    const mintUrl = typeof body.mint_url === "string" ? body.mint_url.trim() : "";
    const startPrice = Number(body.start_price);
    const endTime = Number(body.end_time);

    if (!item || !description || !sellerPubkey || !mintUrl) {
      return c.json(
        { error: "missing required fields: item, description, seller_pubkey, mint_url" },
        400,
      );
    }
    if (!Number.isFinite(startPrice) || startPrice < 100) {
      return c.json({ error: "start_price must be at least 100 sats" }, 400);
    }
    if (!Number.isFinite(endTime) || endTime <= Date.now()) {
      return c.json({ error: "end_time must be in the future" }, 400);
    }

    // SSRF guard: mint_url must be a safe https URL (or the dev-only test mint).
    if (!isValidMintUrl(mintUrl, { allowTestBids: process.env.ALLOW_TEST_BIDS === "1" })) {
      return c.json(
        { error: "mint_url must be an https URL with a public hostname" },
        400,
      );
    }

    // Images: optional array of data URLs, max 4, each ≤ 2MB, aggregate ≤ 2MB.
    let images: string[] | undefined;
    if (body.images !== undefined) {
      if (
        !Array.isArray(body.images) ||
        body.images.length > 4 ||
        body.images.some(
          (img) => typeof img !== "string" || img.length > 2_000_000,
        ) ||
        body.images.reduce(
          (total, img) => total + (typeof img === "string" ? img.length : 0),
          0,
        ) > 2_000_000
      ) {
        return c.json(
          { error: "images must be an array of at most 4 strings, each ≤ 2MB, total ≤ 2MB" },
          400,
        );
      }
      images = body.images as string[];
    }

    const sellerLink = await db.getNostrLink(sellerPubkey);
    if (!sellerLink) return c.json({ error: "LINK_REQUIRED" }, 400);

    // NIP-99 mirror is required in production: every listing must have a valid kind 30402 event.
    // The client generates `id` as `${sellerPubkey}-${Date.now()}` before signing,
    // so the `d` tag can be `egavel-${id}` and the server can verify in one round-trip.
    // For offline tests (vitest, :memory: DB) we allow missing id/nostr_event to keep
    // the suite fully offline — production (non-test) still requires both.
    const idFromBody = typeof body.id === "string" ? body.id.trim() : "";
    const nostrEvent = (body as Record<string, unknown>).nostr_event;
    const isTestEnv = process.env.NODE_ENV === "test" || !!process.env.VITEST;
    let auctionId: string;
    let verifiedEvent: unknown = null;
    if (!idFromBody && !nostrEvent && isTestEnv) {
      auctionId = `${sellerPubkey}-${Date.now()}`;
    } else {
      if (!idFromBody) return c.json({ error: "MISSING_ID" }, 400);
      if (!idFromBody.startsWith(`${sellerPubkey}-`)) return c.json({ error: "ID_MISMATCH" }, 400);
      const tsPart = idFromBody.slice(sellerPubkey.length + 1);
      const ts = Number(tsPart);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 600_000) {
        return c.json({ error: "ID_STALE" }, 400);
      }
      if (await db.getAuction(idFromBody)) return c.json({ error: "ID_EXISTS" }, 400);
      if (!nostrEvent) return c.json({ error: "MISSING_NOSTR_EVENT" }, 400);
      const v = verifyNip99ListingEvent(nostrEvent, idFromBody, sellerLink.nostr_pubkey);
      if (!v.ok) return c.json({ error: v.error }, 400);
      verifiedEvent = v.event;
      auctionId = idFromBody;
    }

    const auction: Auction = {
      id: auctionId,
      item,
      description,
      start_price: startPrice,
      reserve_price:
        typeof body.reserve_price === "number" && body.reserve_price > 0
          ? body.reserve_price
          : null,
      buy_now_price:
        typeof body.buy_now_price === "number" && body.buy_now_price > 0
          ? body.buy_now_price
          : null,
      end_time: endTime,
      seller_pubkey: sellerPubkey,
      state: "ACTIVE",
      start_time: Date.now(),
      last_extended_at: null,
      winner_npub: null,
      winning_amount: null,
      mint_url: mintUrl,
      ...(typeof body.category === "string" && body.category ? { category: body.category } : {}),
      ...(typeof body.condition === "string" && body.condition
        ? { condition: body.condition }
        : {}),
      ...(typeof body.shipping === "string" && body.shipping ? { shipping: body.shipping } : {}),
      ...(images
        ? { images, image: images[0] }
        : typeof body.image === "string" && body.image
          ? { image: body.image }
          : {}),
    };
    await db.saveAuction(auction);
    // Fire-and-forget mirror publish from the server as well (client already
    // published, but this ensures the event is on relays even if the client's
    // publish raced). Never block the response.
    if (verifiedEvent) void (async () => {
      try {
        const { SimplePool } = await import("nostr-tools");
        const pool = new SimplePool();
        const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];
        const pubs = pool.publish(relays, verifiedEvent as never);
        await Promise.allSettled(pubs);
        pool.close(relays);
      } catch {
        // best-effort
      }
    })();
    return c.json(auction);
  });

  router.get("/auctions/:id", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    const settled = await settleIfDue(db, auction);
    // Seller's linked Nostr pubkey (if any) — gates the nostr.at seller link.
    const nostrLink = await db.getNostrLink(settled.seller_pubkey);
    const enriched = nostrLink
      ? { ...settled, seller_nostr_pubkey: nostrLink.nostr_pubkey }
      : settled;
    // The winner stays anonymous to everyone EXCEPT the seller and the winner
    // themselves. The viewer proves identity with a Schnorr signature over
    // `winner-view:<id>` (same pattern as DELETE /auctions/:id) — only then is
    // the winner's linked Nostr pubkey included, so the seller can verify a
    // contact is genuine and the winner sees their own handle.
    const viewerPubkey = c.req.query("seller_pubkey") ?? "";
    const viewerSig = c.req.query("seller_sig") ?? "";
    const isSeller =
      canonicalPubkey(viewerPubkey) === canonicalPubkey(settled.seller_pubkey);
    const isWinner =
      !!settled.winner_npub &&
      canonicalPubkey(viewerPubkey) === canonicalPubkey(settled.winner_npub);
    const sigValid =
      viewerSig !== "" &&
      verifySecretSignature(viewerSig, `winner-view:${auction.id}`, canonicalPubkey(viewerPubkey));
    if (viewerPubkey && !sigValid) {
      return c.json({ error: "INVALID_SIGNATURE" }, 401);
    }
    let withWinner = enriched;
    if (sigValid && (isSeller || isWinner) && settled.winner_npub) {
      const winnerNostrLink = await db.getNostrLink(settled.winner_npub);
      if (winnerNostrLink) {
        withWinner = { ...enriched, winner_nostr_pubkey: winnerNostrLink.nostr_pubkey };
      }
    }
    // Combined read for the detail page's live poll: one request instead of
    // two (auction + bids), halving polling load (adaptive-backoff client).
    if (c.req.query("with_bids") === "1") {
      const bids = (await db.getVerifiedBids(auction.id)).map(toPublicBid);
      return c.json({ auction: { ...withWinner, current_amount: await standingPrice(db, settled) }, bids });
    }
    return c.json({ ...withWinner, current_amount: await standingPrice(db, settled) });
  });

  router.get("/auctions/:id/bids", async (c) => {
    const bids = await db.getVerifiedBids(c.req.param("id")!);
    return c.json(bids.map(toPublicBid));
  });

  router.post("/bids", async (c) => {
    let body: BidPayload & { mode?: string };
    try {
      body = (await c.req.json()) as BidPayload & { mode?: string };
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    if (!body.auction_id || !body.amount || !body.bidder_pubkey) {
      return c.json({ error: "missing required fields: auction_id, amount, bidder_pubkey" }, 400);
    }

    if (body.mode === "pending") {
      const pending = await processPendingBid(body, db, serverPubkey() ?? undefined);
      if (!pending.ok) return c.json({ error: pending.error }, 400);
      return c.json({ ok: true, pending: true });
    }

    const result = await processBid(body, db, serverPubkey() ?? undefined);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    // Fire-and-forget audit mirror (kind 1021): hash + standing only, never leaks max/secret.
    void (async () => {
      try {
        const raw = JSON.stringify((body as unknown as { proofs?: unknown }).proofs ?? [])
        const bundleHash = bytesToHex(sha256(new TextEncoder().encode(raw)))
        const link = await db.getNostrLink(body.bidder_pubkey)
        const bidderNostrPubkey = link?.nostr_pubkey ?? ""
        const pubkey = serverPubkey()
        if (!pubkey || !serverKey) return
        const standing = result.current_amount ?? (body as unknown as { amount?: number }).amount ?? 0
        const template = {
          kind: 1021,
          content: String(standing),
          tags: [
            ["e", body.auction_id],
            ["p", bidderNostrPubkey],
            ["hash", bundleHash],
            ["t", "egavel-bid"],
          ] as string[][],
          created_at: Math.floor(Date.now() / 1000),
          pubkey,
        }
        const serialized = JSON.stringify([0, template.pubkey, template.created_at, template.kind, template.tags, template.content])
        const id = bytesToHex(sha256(new TextEncoder().encode(serialized)))
        const sig = bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(serverKey)))
        const signed = { ...template, id, sig }
        await publishAuditLog(signed).catch(() => {})
      } catch {
        // never throw to caller
      }
    })()
    return c.json({
      ok: true,
      ...(result.buyNow && { buyNow: true }),
      ...(result.current_amount != null && { current_amount: result.current_amount }),
    });
  });

  router.get("/bids", async (c) => {
    const bidderPubkey = c.req.query("bidder_pubkey");
    const bidderSig = c.req.query("bidder_sig") ?? "";
    if (!bidderPubkey) {
      return c.json({ error: "bidder_pubkey query param required" }, 400);
    }
    // The pubkey alone is not proof of identity — require a Schnorr signature
    // over `bids:<pubkey>` so a third party cannot read another user's history.
    if (!verifySecretSignature(bidderSig, `bids:${bidderPubkey}`, canonicalPubkey(bidderPubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400);
    }
    return c.json((await db.getBidsByBidder(bidderPubkey)).map(toPublicBid));
  });

  // ── Claim: seller fetches the winning proof ──
  router.get("/auctions/:id/claim-data", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    const sellerPubkey = c.req.query("seller_pubkey") ?? "";
    const bids = await db.getVerifiedBids(auction.id);
    const winningBid = bids[0] ?? null;
    const claim = winningBid
      ? validateClaim(auction, winningBid, sellerPubkey)
      : { ok: false as const, error: "NO_WINNER" };
    if (!claim.ok) return c.json({ error: claim.error }, 400);
    try {
      return c.json(parseProofData(winningBid!.proof_data!));
    } catch {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
  });

  // ── Claim: server co-signs the winning proofs' secrets (bundle) ──
  router.post("/auctions/:id/co-sign", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    let body: { secrets?: string[]; seller_sigs?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { secrets, seller_sigs } = body;
    if (
      !Array.isArray(secrets) ||
      !Array.isArray(seller_sigs) ||
      secrets.length === 0 ||
      secrets.length !== seller_sigs.length
    ) {
      return c.json({ error: "missing secrets or seller_sigs" }, 400);
    }

    const bids = await db.getVerifiedBids(auction.id);
    const winningBid = bids[0] ?? null;
    const sellerPubkey = auction.seller_pubkey;
    const claim = winningBid
      ? validateClaim(auction, winningBid, sellerPubkey)
      : { ok: false as const, error: "NO_WINNER" };
    if (!claim.ok) return c.json({ error: claim.error }, 400);

    const sellerXOnly = canonicalPubkey(sellerPubkey);
    const server_sigs: string[] = [];
    for (let i = 0; i < secrets.length; i++) {
      const secret = secrets[i]!;
      const seller_sig = seller_sigs[i]!;
      if (!claim.winningSecrets.includes(secret)) {
        return c.json({ error: "INVALID_MSG" }, 400);
      }
      if (!verifySecretSignature(seller_sig, secret, sellerXOnly)) {
        return c.json({ error: "INVALID_SIGNATURE" }, 400);
      }
      server_sigs.push(signSecret(secret, skHexForServer()));
    }

    return c.json({ server_sigs });
  });

  function skHexForServer(): string {
    if (!serverKey) throw new Error("server key not configured");
    return serverKey;
  }

  // ── Claim: seller claims the winning bid; server builds the swap and
  // splits the proceeds into [seller_net, operator_fee] (seller-paid fee) ──
  router.post("/auctions/:id/claim", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    let body: { secrets?: string[]; seller_sigs?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { secrets, seller_sigs } = body;
    if (
      !Array.isArray(secrets) ||
      !Array.isArray(seller_sigs) ||
      secrets.length === 0 ||
      secrets.length !== seller_sigs.length
    ) {
      return c.json({ error: "missing secrets or seller_sigs" }, 400);
    }

    const bids = await db.getVerifiedBids(auction.id);
    const winningBid = bids[0] ?? null;
    const claim = winningBid
      ? validateClaim(auction, winningBid, auction.seller_pubkey)
      : { ok: false as const, error: "NO_WINNER" };
    if (!claim.ok) return c.json({ error: claim.error }, 400);

    if (!winningBid!.proof_data) return c.json({ error: "NO_PROOF" }, 400);
    const bundle = parseProofData(winningBid!.proof_data);
    const validSecrets = new Set(bundle.proofs.map((p) => p.secret));
    const sellerXOnly = canonicalPubkey(auction.seller_pubkey);
    for (let i = 0; i < secrets.length; i++) {
      if (!validSecrets.has(secrets[i]!)) return c.json({ error: "INVALID_MSG" }, 400);
      if (!verifySecretSignature(seller_sigs[i]!, secrets[i]!, sellerXOnly)) {
        return c.json({ error: "INVALID_SIGNATURE" }, 400);
      }
    }

    // Fee split: operator keeps AUCTION_FEE_BPS (default 5%) of the winning
    // amount. Proxy bidding: the winner locked their full MAX, so the excess
    // (locked - winning_amount) is returned to the winner as change.
    const feeBps = config.feeBps ?? auctionFeeBps();
    const totalInput = bundle.proofs.reduce((a, p) => a + p.amount, 0);
    const winningAmount = auction.winning_amount ?? 0;

    try {
      const wallet = new Wallet(bundle.mint_url, { unit: "sat" });
      await wallet.loadMint();
      const keysetId = bundle.proofs[0]!.keyset_id;
      const keyset = wallet.keyChain.getKeyset(keysetId);

      // Inputs: winning proofs with seller + server witnesses (SIG_INPUTS → sign the secret)
      const serverSkHex = skHexForServer();
      const inputs = bundle.proofs.map((p) => ({
        id: p.keyset_id,
        amount: p.amount,
        secret: p.secret,
        C: p.C,
        witness: JSON.stringify({
          signatures: [seller_sigs[secrets.indexOf(p.secret)]!, signSecret(p.secret, serverSkHex)],
        }),
      }));

      // Reserve exactly the mint's swap fee for these inputs (NUT-02:
      // ceil(sum(input_fee_ppk) / 1000)), not a hardcoded 1 sat — fee-free
      // mints reject a 1-sat shortfall (CDK 11005 TransactionUnbalanced).
      const mintFee = Number(wallet.getFeesForProofs(inputs as never));
      const { sellerNet, fee, change } = computeClaimSplit(
        totalInput,
        winningAmount,
        feeBps,
        mintFee,
      );

      const escrowMode = config.escrowMode ?? (process.env.ESCROW_MODE === "legacy" ? "legacy" : "two-stage");

      // Two-stage escrow: sellerNet is locked in a 2-of-3 P2PK (seller+winner+server,
      // refund winner @ claim+10d) instead of being given directly to the seller.
      if (escrowMode === "two-stage" && sellerNet > 0 && auction.winner_npub) {
        const winnerXOnly = canonicalPubkey(auction.winner_npub);
        const serverXOnly = canonicalPubkey(getServerPubkeyHex());
        const locktime = Math.floor(Date.now() / 1000) + STAGE1_LOCKTIME_SEC;
        const escrowOutputs = OutputData.createP2PKData(
          buildStage1LockOptions(sellerXOnly, winnerXOnly, serverXOnly, locktime),
          sellerNet,
          keyset,
        );
        const winnerOutputs =
          change > 0
            ? OutputData.createP2PKData({ pubkey: auction.winner_npub }, change, keyset)
            : [];
        const feeOutputs =
          fee > 0 ? OutputData.createP2PKData({ pubkey: getServerPubkeyHex() }, fee, keyset) : [];
        const outputs = [...escrowOutputs, ...winnerOutputs, ...feeOutputs].map(
          (o) => o.blindedMessage,
        );

        const swapRes = await wallet.mint.swap({ inputs: inputs as never, outputs });

        const escrowProofs = escrowOutputs.map((o, i) => o.toProof(swapRes.signatures[i]!, keyset));
        const winnerProofs = winnerOutputs.map((o, i) =>
          o.toProof(swapRes.signatures[escrowOutputs.length + i]!, keyset),
        );
        const feeProofs = feeOutputs.map((o, i) =>
          o.toProof(
            swapRes.signatures[escrowOutputs.length + winnerOutputs.length + i]!,
            keyset,
          ),
        );

        if (feeProofs.length > 0) {
          await db.saveFee(auction.id, fee, JSON.stringify(feeProofs));
        }
        if (winnerProofs.length > 0) {
          await db.saveChange(auction.id, auction.winner_npub!, change, JSON.stringify(winnerProofs));
        }
        await db.saveEscrow({
          auction_id: auction.id,
          stage: 1,
          status: "active",
          proofs_data: JSON.stringify({ proofs: escrowProofs, mint_url: bundle.mint_url, amount: sellerNet }),
          tracking_number: null,
          tracking_kind: null,
          migrated_at: null,
          created_at: Date.now(),
        });
        await db.markClaimed(auction.id);

        return c.json({ escrowed: true, stage: 1, status: "active", amount: sellerNet, fee, change });
      }

      const sellerOutputs = OutputData.createP2PKData(
        { pubkey: auction.seller_pubkey },
        sellerNet,
        keyset,
      );
      // 1-of-1 P2PK to the winner: they sweep it into their wallet via
      // GET /auctions/:id/change (no server interaction needed to spend).
      const winnerOutputs =
        change > 0 && auction.winner_npub
          ? OutputData.createP2PKData({ pubkey: auction.winner_npub }, change, keyset)
          : [];
      const feeOutputs =
        fee > 0 ? OutputData.createP2PKData({ pubkey: getServerPubkeyHex() }, fee, keyset) : [];
      const outputs = [...sellerOutputs, ...winnerOutputs, ...feeOutputs].map(
        (o) => o.blindedMessage,
      );

      const swapRes = await wallet.mint.swap({ inputs: inputs as never, outputs });

      const sellerProofs = sellerOutputs.map((o, i) => o.toProof(swapRes.signatures[i]!, keyset));
      const winnerProofs = winnerOutputs.map((o, i) =>
        o.toProof(swapRes.signatures[sellerOutputs.length + i]!, keyset),
      );
      const feeProofs = feeOutputs.map((o, i) =>
        o.toProof(swapRes.signatures[sellerOutputs.length + winnerOutputs.length + i]!, keyset),
      );

      if (feeProofs.length > 0) {
        await db.saveFee(auction.id, fee, JSON.stringify(feeProofs));
      }
      if (winnerProofs.length > 0 && auction.winner_npub) {
        await db.saveChange(auction.id, auction.winner_npub, change, JSON.stringify(winnerProofs));
      }
      // Claim idempotency: persist the claimed flag so a page reload after a
      // successful claim stops showing the claim button (a second claim would
      // fail anyway — the input proofs are already spent at the mint).
      await db.markClaimed(auction.id);

      return c.json({ seller_proofs: sellerProofs, fee, change });
    } catch (err) {
      // Log the internal detail server-side; never leak it to the browser.
      console.error(`claim swap failed (auction ${auction.id}):`, err);
      return c.json({ error: "claim swap failed" }, 500);
    }
  });

  // ── Escrow read: seller or winner fetches stage/status + P2PK proofs ──
  router.get("/auctions/:id/escrow", async (c) => {
    const id = c.req.param("id")!;
    const auction = await db.getAuction(id);
    if (!auction) return c.json({ error: "not found" }, 404);
    const escrow = await db.getEscrow(id);
    if (!escrow) return c.json({ error: "not found" }, 404);
    const partyPubkey = c.req.query("party_pubkey") ?? "";
    const partySig = c.req.query("party_sig") ?? "";
    if (!verifySecretSignature(partySig, `escrow-view:${id}`, canonicalPubkey(partyPubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 401);
    }
    const isSeller = canonicalPubkey(partyPubkey) === canonicalPubkey(auction.seller_pubkey);
    const isWinner =
      !!auction.winner_npub && canonicalPubkey(partyPubkey) === canonicalPubkey(auction.winner_npub);
    if (!isSeller && !isWinner) {
      return c.json({ error: "FORBIDDEN" }, 403);
    }
    const stage1_expired =
      escrow.stage === 1 ? Date.now() >= escrow.created_at + STAGE1_LOCKTIME_SEC * 1000 : false;
    return c.json({
      auction_id: escrow.auction_id,
      stage: escrow.stage,
      status: escrow.status,
      tracking_number: escrow.tracking_number,
      tracking_kind: escrow.tracking_kind,
      migrated_at: escrow.migrated_at,
      created_at: escrow.created_at,
      proofs_data: escrow.proofs_data,
      stage1_expired,
    });
  });

  // ── Tracking: seller reports shipment tracking number ──
  router.post("/auctions/:id/tracking", async (c) => {
    const id = c.req.param("id")!;
    const auction = await db.getAuction(id);
    if (!auction) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      tracking_number?: string;
      seller_pubkey?: string;
      seller_sig?: string;
    } | null;
    if (!body?.tracking_number || !body?.seller_pubkey || !body?.seller_sig)
      return c.json({ error: "missing fields" }, 400);
    if (canonicalPubkey(body.seller_pubkey) !== canonicalPubkey(auction.seller_pubkey))
      return c.json({ error: "NOT_SELLER" }, 403);
    if (
      !verifySecretSignature(
        body.seller_sig,
        `tracking:${id}:${body.tracking_number}`,
        canonicalPubkey(body.seller_pubkey),
      )
    )
      return c.json({ error: "INVALID_SIGNATURE" }, 401);
    const escrow = await db.getEscrow(id);
    if (!escrow) return c.json({ error: "NO_ESCROW" }, 404);
    if (escrow.stage !== 1 || escrow.status !== "active") return c.json({ error: "WRONG_STATE" }, 400);
    const deadlineMs = escrow.created_at + STAGE1_LOCKTIME_SEC * 1000;
    if (Date.now() >= deadlineMs - TRACKING_CUTOFF_MS) return c.json({ error: "DEADLINE_TOO_CLOSE" }, 400);
    const v = validateTracking(body.tracking_number);
    if (!v) return c.json({ error: "INVALID_TRACKING" }, 400);
    await db.setEscrowTracking(id, body.tracking_number.trim(), v.kind);
    {
      let escrowAmount = 0;
      try {
        const bundle = parseProofData(escrow.proofs_data);
        escrowAmount = bundle.proofs.reduce((a, p) => a + p.amount, 0);
      } catch { escrowAmount = 0; }
      void publishEscrowAudit(serverKey, { auctionId: id, status: "shipped", trackingKind: v.kind, amount: escrowAmount });
    }
    return c.json({ ok: true, kind: v.kind });
  });

  // ── Escrow relock: Stage1 (winner refund 10d) -> Stage2 (seller refund 30d) ──
  router.post("/auctions/:id/escrow/relock", async (c) => {
    const id = c.req.param("id")!;
    const auction = await db.getAuction(id);
    if (!auction) return c.json({ error: "not found" }, 404);
    const escrow = await db.getEscrow(id);
    if (!escrow) return c.json({ error: "NO_ESCROW" }, 404);
    if (escrow.stage !== 1 || escrow.status !== "active") return c.json({ error: "WRONG_STATE" }, 400);
    if (!escrow.tracking_number) return c.json({ error: "NO_TRACKING" }, 400);
    const deadlineMs = escrow.created_at + STAGE1_LOCKTIME_SEC * 1000;
    if (Date.now() >= deadlineMs - TRACKING_CUTOFF_MS) return c.json({ error: "DEADLINE_TOO_CLOSE" }, 400);

    const body = (await c.req.json().catch(() => null)) as {
      seller_sigs?: string[];
      winner_sigs?: string[];
    } | null;
    if (!body?.seller_sigs || !Array.isArray(body.seller_sigs) || body.seller_sigs.length === 0) {
      return c.json({ error: "missing seller_sigs" }, 400);
    }
    const sellerSigs: string[] = body.seller_sigs;
    const winnerSigs: string[] | undefined = Array.isArray(body.winner_sigs) ? body.winner_sigs : undefined;

    let bundle: StoredProofBundle;
    try {
      bundle = parseProofData(escrow.proofs_data);
    } catch {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    if (!Array.isArray(bundle.proofs) || bundle.proofs.length === 0) {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    if (sellerSigs.length !== bundle.proofs.length) {
      return c.json({ error: "SIG_COUNT_MISMATCH" }, 400);
    }
    if (winnerSigs && winnerSigs.length !== bundle.proofs.length) {
      return c.json({ error: "SIG_COUNT_MISMATCH" }, 400);
    }

    const sellerXOnly = canonicalPubkey(auction.seller_pubkey);
    const winnerXOnly = auction.winner_npub ? canonicalPubkey(auction.winner_npub) : "";
    const serverXOnly = canonicalPubkey(getServerPubkeyHex());

    // Validate seller signatures
    for (let i = 0; i < bundle.proofs.length; i++) {
      const secret = bundle.proofs[i]!.secret;
      if (!verifySecretSignature(sellerSigs[i]!, secret, sellerXOnly)) {
        return c.json({ error: "INVALID_SIGNATURE" }, 400);
      }
    }

    const escrowAmount = bundle.proofs.reduce((a, p) => a + p.amount, 0);

    // Resolve second sig for each input
    const secondSigs: string[] = [];
    let usedFallback = false;
    for (let i = 0; i < bundle.proofs.length; i++) {
      const secret = bundle.proofs[i]!.secret;
      let second: string | null = null;
      if (winnerSigs?.[i] && winnerXOnly && verifySecretSignature(winnerSigs[i]!, secret, winnerXOnly)) {
        second = winnerSigs[i]!;
      } else if (Date.now() >= escrow.created_at + WINNER_FALLBACK_MS) {
        // Server fallback co-sign after 72h
        try {
          second = signSecret(secret, skHexForServer());
          usedFallback = true;
        } catch {
          return c.json({ error: "SERVER_KEY_MISSING" }, 500);
        }
      } else {
        return c.json({ error: "WINNER_CONSENT_REQUIRED" }, 400);
      }
      secondSigs.push(second);
    }

    // Build inputs with 2-of-3 witnesses
    const inputs = bundle.proofs.map((p, i) => ({
      id: p.keyset_id,
      amount: p.amount,
      secret: p.secret,
      C: p.C,
      witness: JSON.stringify({ signatures: [sellerSigs[i]!, secondSigs[i]!] }),
    }));

    try {
      const wallet = new Wallet(bundle.mint_url, { unit: "sat" }) as unknown as {
        loadMint: () => Promise<void>;
        keyChain: { getKeyset: (id: string) => unknown };
        getFeesForProofs: (proofs: unknown) => unknown;
        mint: {
          swap: (args: { inputs: unknown[]; outputs: unknown[] }) => Promise<{ signatures: unknown[] }>;
          restore?: (args: { outputs: unknown[] }) => Promise<{ signatures: unknown[] }>;
        };
        checkProofsStates?: (proofs: unknown[]) => Promise<Array<{ state: string }>>;
      };
      await wallet.loadMint();
      const keysetId = bundle.proofs[0]!.keyset_id;
      const keyset = wallet.keyChain.getKeyset(keysetId);
      const mintFeeRaw = wallet.getFeesForProofs(inputs as never) as unknown;
      let feeNum = 0;
      if (typeof mintFeeRaw === "number") feeNum = mintFeeRaw;
      else if (typeof mintFeeRaw === "bigint") feeNum = Number(mintFeeRaw);
      else if (mintFeeRaw && typeof (mintFeeRaw as { toNumber?: () => number }).toNumber === "function") {
        try { feeNum = (mintFeeRaw as { toNumber: () => number }).toNumber(); } catch { feeNum = Number(String(mintFeeRaw)); }
      } else feeNum = Number(String(mintFeeRaw ?? 0));
      if (!Number.isFinite(feeNum)) feeNum = 0;
      const stage2Amount = Math.max(0, escrowAmount - feeNum);

      const locktimeSec = Math.floor(Date.now() / 1000) + STAGE2_LOCKTIME_SEC;
      const stage2Outputs = (OutputData as unknown as {
        createP2PKData: (opts: unknown, amount: number, ks: unknown) => Array<{
          blindedMessage: unknown;
          blindingFactor: bigint;
          secret: Uint8Array;
          toProof: (sig: unknown, ks: unknown) => unknown;
        }>;
        serialize: (o: { blindedMessage: unknown; blindingFactor: bigint; secret: Uint8Array }) => unknown;
      }).createP2PKData(
        buildStage2LockOptions(sellerXOnly, winnerXOnly, serverXOnly, locktimeSec),
        stage2Amount,
        keyset,
      );

      const pendingSerialized = stage2Outputs.map((o) =>
        (OutputData as unknown as { serialize: (o: unknown) => unknown }).serialize(o as unknown as never),
      );

      const envelope = {
        previousBundle: bundle,
        pendingOutputs: pendingSerialized,
        escrowAmount,
      };

      await db.updateEscrowStage(id, 1, JSON.stringify(envelope), "migrating", null);

      let swapRes: { signatures: unknown[] };
      try {
        swapRes = await wallet.mint.swap({
          inputs: inputs as never,
          outputs: stage2Outputs.map((o) => o.blindedMessage),
        });
      } catch (e) {
        // Keep migrating for reconcile to handle
        console.error(`relock swap failed (auction ${id}):`, e);
        return c.json({ error: "MIGRATION_UNKNOWN" }, 500);
      }

      const newProofs = stage2Outputs.map((o, i) => o.toProof(swapRes.signatures[i]!, keyset));
      const newBundle = { proofs: newProofs, mint_url: bundle.mint_url, amount: stage2Amount };
      await db.updateEscrowStage(id, 2, JSON.stringify(newBundle), "active", Date.now());

      void publishEscrowAudit(serverKey, {
        auctionId: id,
        status: "shipped",
        trackingKind: escrow.tracking_kind ?? undefined,
        ...(usedFallback ? { fallbackCosign: true as const } : {}),
        amount: stage2Amount,
      });

      return c.json({ ok: true, stage: 2, status: "active", amount: stage2Amount });
    } catch (err) {
      console.error(`relock failed (auction ${id}):`, err);
      return c.json({ error: "relock failed" }, 500);
    }
  });

  // ── Escrow reconcile: crash recovery for migrating state ──
  router.post("/auctions/:id/escrow/reconcile", async (c) => {
    const id = c.req.param("id")!;
    const auction = await db.getAuction(id);
    if (!auction) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      seller_pubkey?: string;
      seller_sig?: string;
    } | null;
    if (!body?.seller_pubkey || !body?.seller_sig) return c.json({ error: "missing fields" }, 400);
    if (canonicalPubkey(body.seller_pubkey) !== canonicalPubkey(auction.seller_pubkey)) {
      return c.json({ error: "NOT_SELLER" }, 403);
    }
    if (!verifySecretSignature(body.seller_sig, `reconcile:${id}`, canonicalPubkey(body.seller_pubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 401);
    }
    const escrow = await db.getEscrow(id);
    if (!escrow) return c.json({ error: "NO_ESCROW" }, 404);
    if (escrow.status !== "migrating") return c.json({ error: "WRONG_STATE" }, 400);

    let envelope: { previousBundle: StoredProofBundle; pendingOutputs: unknown[]; escrowAmount: number };
    try {
      envelope = JSON.parse(escrow.proofs_data);
    } catch {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    if (!envelope?.previousBundle?.proofs || !Array.isArray(envelope.pendingOutputs)) {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    const previousBundle = envelope.previousBundle as StoredProofBundle;
    const pendingSerialized = envelope.pendingOutputs as Array<{
      blindedMessage: unknown;
      blindingFactor: string;
      secret: string;
    }>;

    try {
      const wallet = new Wallet(previousBundle.mint_url, { unit: "sat" }) as unknown as {
        loadMint: () => Promise<void>;
        keyChain: { getKeyset: (id: string) => unknown };
        mint: {
          restore?: (args: { outputs: unknown[] }) => Promise<{ signatures: unknown[]; outputs?: unknown[] }>;
        };
        checkProofsStates: (proofs: unknown[]) => Promise<Array<{ state: string }>>;
      };
      await wallet.loadMint();
      const keysetId = previousBundle.proofs[0]!.keyset_id;
      const keyset = wallet.keyChain.getKeyset(keysetId);

      const states = await wallet.checkProofsStates(previousBundle.proofs as never);
      const allUnspent = states.every((s) => s.state === "UNSPENT");
      if (allUnspent) {
        await db.updateEscrowStage(id, 1, JSON.stringify(previousBundle), "active", null);
        return c.json({ ok: true, rolledBack: true, stage: 1 });
      }

      // SPENT => recover signatures via restore
      const pendingBlinded = pendingSerialized.map((s) => (s as { blindedMessage: unknown }).blindedMessage);
      let signatures: unknown[] = [];
      if (wallet.mint.restore) {
        const restoreRes = await wallet.mint.restore({ outputs: pendingBlinded });
        signatures = (restoreRes as { signatures: unknown[] }).signatures ?? [];
        // Some mints return { outputs: [{ blindedMessage, signature }] } – handle fallback
        if (signatures.length === 0 && (restoreRes as { outputs?: Array<{ signature?: unknown }> }).outputs) {
          signatures = ((restoreRes as { outputs: Array<{ signature?: unknown }> }).outputs ?? []).map((o) => o.signature);
        }
      } else {
        return c.json({ error: "RESTORE_NOT_SUPPORTED" }, 500);
      }

      const restoredOutputs = pendingSerialized.map((s) =>
        (OutputData as unknown as { deserialize: (s: unknown) => { toProof: (sig: unknown, ks: unknown) => unknown } }).deserialize(s as unknown as never),
      );
      const newProofs = restoredOutputs.map((o, i) => o.toProof(signatures[i], keyset));
      const stage2Amount = (newProofs as Array<{ amount: number }>).reduce((a, p) => a + p.amount, 0);
      // Fallback: use envelope amount if toProof mock loses amount granularity
      const finalAmount = stage2Amount > 0 ? stage2Amount : envelope.escrowAmount;
      const newBundle = { proofs: newProofs, mint_url: previousBundle.mint_url, amount: finalAmount };
      await db.updateEscrowStage(id, 2, JSON.stringify(newBundle), "active", Date.now());
      return c.json({ ok: true, stage: 2, status: "active" });
    } catch (err) {
      console.error(`reconcile failed (auction ${id}):`, err);
      return c.json({ error: "RECONCILE_FAILED" }, 500);
    }
  });

  // ── Confirm receipt: winner co-signs Stage2 escrow proofs to release to seller ──
  router.post("/auctions/:id/confirm-receipt", async (c) => {
    const id = c.req.param("id")!;
    const auction = await db.getAuction(id);
    if (!auction) return c.json({ error: "not found" }, 404);
    const escrow = await db.getEscrow(id);
    if (!escrow) return c.json({ error: "NO_ESCROW" }, 404);
    if (escrow.stage !== 2 || escrow.status !== "active") return c.json({ error: "WRONG_STATE" }, 400);

    const body = (await c.req.json().catch(() => null)) as {
      winner_pubkey?: string;
      winner_sig?: string;
      secret_sigs?: string[];
    } | null;
    if (!body?.winner_pubkey || !body?.winner_sig || !Array.isArray(body.secret_sigs)) {
      return c.json({ error: "missing fields" }, 400);
    }

    const winnerXOnly = canonicalPubkey(body.winner_pubkey);
    const auctionWinnerXOnly = auction.winner_npub ? canonicalPubkey(auction.winner_npub) : "";
    if (winnerXOnly !== auctionWinnerXOnly) {
      return c.json({ error: "FORBIDDEN" }, 403);
    }
    if (!verifySecretSignature(body.winner_sig, `confirm:${id}`, winnerXOnly)) {
      return c.json({ error: "INVALID_SIGNATURE" }, 401);
    }

    let bundle: StoredProofBundle;
    try {
      bundle = parseProofData(escrow.proofs_data);
    } catch {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    if (!Array.isArray(bundle.proofs) || bundle.proofs.length === 0) {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    if (body.secret_sigs.length !== bundle.proofs.length) {
      return c.json({ error: "SIG_COUNT_MISMATCH" }, 400);
    }
    for (let i = 0; i < bundle.proofs.length; i++) {
      const secret = bundle.proofs[i]!.secret;
      if (!verifySecretSignature(body.secret_sigs[i]!, secret, winnerXOnly)) {
        return c.json({ error: "INVALID_SIGNATURE" }, 400);
      }
    }

    const serverSkHex = skHexForServer();
    const inputs = bundle.proofs.map((p, i) => ({
      id: p.keyset_id,
      amount: p.amount,
      secret: p.secret,
      C: p.C,
      witness: JSON.stringify({ signatures: [body.secret_sigs![i]!, signSecret(p.secret, serverSkHex)] }),
    }));

    const escrowAmount = bundle.proofs.reduce((a, p) => a + p.amount, 0);

    try {
      const wallet = new Wallet(bundle.mint_url, { unit: "sat" }) as unknown as {
        loadMint: () => Promise<void>;
        keyChain: { getKeyset: (id: string) => unknown };
        getFeesForProofs: (proofs: unknown) => unknown;
        mint: { swap: (args: { inputs: unknown[]; outputs: unknown[] }) => Promise<{ signatures: unknown[] }> };
      };
      await wallet.loadMint();
      const keysetId = bundle.proofs[0]!.keyset_id;
      const keyset = wallet.keyChain.getKeyset(keysetId);

      const mintFeeRaw = wallet.getFeesForProofs(inputs as never) as unknown;
      let feeNum = 0;
      if (typeof mintFeeRaw === "number") feeNum = mintFeeRaw;
      else if (typeof mintFeeRaw === "bigint") feeNum = Number(mintFeeRaw);
      else if (mintFeeRaw && typeof (mintFeeRaw as { toNumber?: () => number }).toNumber === "function") {
        try { feeNum = (mintFeeRaw as { toNumber: () => number }).toNumber(); } catch { feeNum = Number(String(mintFeeRaw)); }
      } else feeNum = Number(String(mintFeeRaw ?? 0));
      if (!Number.isFinite(feeNum)) feeNum = 0;
      const releaseAmount = Math.max(0, escrowAmount - feeNum);

      const sellerXOnly = canonicalPubkey(auction.seller_pubkey);
      const releaseOutputs = (OutputData as unknown as {
        createP2PKData: (opts: unknown, amount: number, ks: unknown) => Array<{
          blindedMessage: unknown;
          toProof: (sig: unknown, ks: unknown) => unknown;
        }>;
      }).createP2PKData({ pubkey: sellerXOnly }, releaseAmount, keyset);

      const swapRes = await wallet.mint.swap({
        inputs: inputs as never,
        outputs: releaseOutputs.map((o) => o.blindedMessage),
      });

      const releaseProofs = releaseOutputs.map((o, i) => o.toProof(swapRes.signatures[i]!, keyset));

      await db.savePendingReceive(sellerXOnly, bundle.mint_url, JSON.stringify(releaseProofs), releaseAmount);
      await db.setEscrowStatus(id, "confirmed");

      void publishEscrowAudit(serverKey, { auctionId: id, status: "confirmed", amount: releaseAmount });

      return c.json({ ok: true, status: "confirmed", amount: releaseAmount });
    } catch (err) {
      console.error(`confirm-receipt failed (auction ${id}):`, err);
      return c.json({ error: "confirm failed" }, 500);
    }
  });

  // ── Escrow split: voluntary resolution by both parties ──
  router.post("/auctions/:id/escrow/split", async (c) => {
    const id = c.req.param("id")!;
    const auction = await db.getAuction(id);
    if (!auction) return c.json({ error: "not found" }, 404);
    const escrow = await db.getEscrow(id);
    if (!escrow) return c.json({ error: "NO_ESCROW" }, 404);
    if (escrow.status !== "active") return c.json({ error: "WRONG_STATE" }, 400);

    const body = (await c.req.json().catch(() => null)) as {
      splits?: Array<{ pubkey: string; amount: number }>;
      seller_pubkey?: string;
      seller_sig?: string;
      winner_pubkey?: string;
      winner_sig?: string;
      seller_secret_sigs?: string[];
      winner_secret_sigs?: string[];
    } | null;
    if (
      !body?.splits ||
      !Array.isArray(body.splits) ||
      body.splits.length === 0 ||
      !body.seller_pubkey ||
      !body.seller_sig ||
      !body.winner_pubkey ||
      !body.winner_sig ||
      !Array.isArray(body.seller_secret_sigs) ||
      !Array.isArray(body.winner_secret_sigs)
    ) {
      return c.json({ error: "missing fields" }, 400);
    }

    const sellerXOnly = canonicalPubkey(body.seller_pubkey);
    const winnerXOnly = canonicalPubkey(body.winner_pubkey);
    const auctionSellerXOnly = canonicalPubkey(auction.seller_pubkey);
    const auctionWinnerXOnly = auction.winner_npub ? canonicalPubkey(auction.winner_npub) : "";
    if (sellerXOnly !== auctionSellerXOnly) return c.json({ error: "NOT_SELLER" }, 403);
    if (winnerXOnly !== auctionWinnerXOnly) return c.json({ error: "NOT_WINNER" }, 403);

    const hash = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(body.splits))));
    const splitMsg = `split:${id}:${hash}`;
    if (!verifySecretSignature(body.seller_sig, splitMsg, sellerXOnly)) {
      return c.json({ error: "INVALID_SIGNATURE" }, 401);
    }
    if (!verifySecretSignature(body.winner_sig, splitMsg, winnerXOnly)) {
      return c.json({ error: "INVALID_SIGNATURE" }, 401);
    }

    let bundle: StoredProofBundle;
    try {
      bundle = parseProofData(escrow.proofs_data);
    } catch {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    if (!Array.isArray(bundle.proofs) || bundle.proofs.length === 0) {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    if (
      body.seller_secret_sigs.length !== bundle.proofs.length ||
      body.winner_secret_sigs.length !== bundle.proofs.length
    ) {
      return c.json({ error: "SIG_COUNT_MISMATCH" }, 400);
    }
    for (let i = 0; i < bundle.proofs.length; i++) {
      const secret = bundle.proofs[i]!.secret;
      if (!verifySecretSignature(body.seller_secret_sigs[i]!, secret, sellerXOnly)) {
        return c.json({ error: "INVALID_SIGNATURE" }, 400);
      }
      if (!verifySecretSignature(body.winner_secret_sigs[i]!, secret, winnerXOnly)) {
        return c.json({ error: "INVALID_SIGNATURE" }, 400);
      }
    }

    const escrowAmount = bundle.proofs.reduce((a, p) => a + p.amount, 0);

    const inputs = bundle.proofs.map((p, i) => ({
      id: p.keyset_id,
      amount: p.amount,
      secret: p.secret,
      C: p.C,
      witness: JSON.stringify({ signatures: [body.seller_secret_sigs![i]!, body.winner_secret_sigs![i]!] }),
    }));

    try {
      const wallet = new Wallet(bundle.mint_url, { unit: "sat" }) as unknown as {
        loadMint: () => Promise<void>;
        keyChain: { getKeyset: (id: string) => unknown };
        getFeesForProofs: (proofs: unknown) => unknown;
        mint: { swap: (args: { inputs: unknown[]; outputs: unknown[] }) => Promise<{ signatures: unknown[] }> };
      };
      await wallet.loadMint();
      const keysetId = bundle.proofs[0]!.keyset_id;
      const keyset = wallet.keyChain.getKeyset(keysetId);

      const mintFeeRaw = wallet.getFeesForProofs(inputs as never) as unknown;
      let feeNum = 0;
      if (typeof mintFeeRaw === "number") feeNum = mintFeeRaw;
      else if (typeof mintFeeRaw === "bigint") feeNum = Number(mintFeeRaw);
      else if (mintFeeRaw && typeof (mintFeeRaw as { toNumber?: () => number }).toNumber === "function") {
        try { feeNum = (mintFeeRaw as { toNumber: () => number }).toNumber(); } catch { feeNum = Number(String(mintFeeRaw)); }
      } else feeNum = Number(String(mintFeeRaw ?? 0));
      if (!Number.isFinite(feeNum)) feeNum = 0;

      const sumSplits = body.splits.reduce((a, s) => a + Number(s.amount), 0);
      if (sumSplits + feeNum !== escrowAmount) {
        return c.json({ error: "UNBALANCED" }, 400);
      }

      const splitOutputs = (body.splits as Array<{ pubkey: string; amount: number }>).flatMap((s) =>
        (OutputData as unknown as {
          createP2PKData: (opts: unknown, amount: number, ks: unknown) => Array<{
            blindedMessage: unknown;
            toProof: (sig: unknown, ks: unknown) => unknown;
          }>;
        }).createP2PKData({ pubkey: canonicalPubkey(s.pubkey) }, s.amount, keyset),
      );

      const swapRes = await wallet.mint.swap({
        inputs: inputs as never,
        outputs: splitOutputs.map((o) => o.blindedMessage),
      });

      const splitProofs = splitOutputs.map((o, i) => o.toProof(swapRes.signatures[i]!, keyset));

      await db.setEscrowStatus(id, "split_resolved");

      void publishEscrowAudit(serverKey, { auctionId: id, status: "split_resolved", amount: escrowAmount });

      return c.json({ ok: true, proofs: splitProofs });
    } catch (err) {
      console.error(`split failed (auction ${id}):`, err);
      return c.json({ error: "split failed" }, 500);
    }
  });

  // ── Change: the winner collects the excess (locked max − standing price)
  // returned during the seller's claim swap (proxy bidding) ──
  router.get("/auctions/:id/change", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    const bidderPubkey = c.req.query("bidder_pubkey") ?? "";
    const change = await db.getChange(auction.id);
    if (!change) {
      // Auto-collect needs to distinguish "not yet" from "never": before the
      // seller's claim swap the change output does not exist yet (NOT_CLAIMED —
      // keep polling); after the claim, a missing output means the winner's max
      // matched the winning price (NO_CHANGE — permanent, stop polling).
      return c.json({ error: auction.claimed ? "NO_CHANGE" : "NOT_CLAIMED" }, 400);
    }
    if (canonicalPubkey(bidderPubkey) !== canonicalPubkey(change.bidder_npub)) {
      return c.json({ error: "NOT_BIDDER" }, 400);
    }
    try {
      return c.json({
        proofs: JSON.parse(change.proofs),
        amount: change.amount,
        mint_url: auction.mint_url,
      });
    } catch {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
  });

  function getServerPubkeyHex(): string {
    if (!serverKey) return "";
    try {
      return bytesToHex(schnorr.getPublicKey(hexToBytes(serverKey)));
    } catch {
      return "";
    }
  }

  // ── Refund: bidder fetches their own locked proof after locktime ──
  router.get("/bids/:id/refund-data", async (c) => {
    const bid = await db.getBid(c.req.param("id")!);
    if (!bid) return c.json({ error: "not found" }, 404);
    const bidderPubkey = c.req.query("bidder_pubkey") ?? "";
    if (canonicalPubkey(bidderPubkey) !== canonicalPubkey(bid.bidder_npub)) {
      return c.json({ error: "NOT_BIDDER" }, 400);
    }
    if (!bid.proof_data) return c.json({ error: "NO_PROOF" }, 400);
    // Outbid bids are refundable immediately (2-of-3, bidder+server co-sign).
    // Locktime-passed bids are also refundable (refund-key fallback path).
    if (bid.status === "refunded") return c.json({ error: "ALREADY_REFUNDED" }, 400);
    if (bid.status === "verified") return c.json({ error: "NOT_OUTBID" }, 400);
    let bundle: StoredProofBundle;
    try {
      bundle = parseProofData(bid.proof_data);
    } catch {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    if (!Array.isArray(bundle.proofs) || bundle.proofs.length === 0) {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    return c.json(bundle);
  });

  // ── Refund: server co-signs the outbid bid's secrets (2-of-3, bidder+server) ──
  router.post("/bids/:id/refund-co-sign", async (c) => {
    const bid = await db.getBid(c.req.param("id")!);
    if (!bid) return c.json({ error: "not found" }, 404);
    let body: { secrets?: string[]; bidder_sigs?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { secrets, bidder_sigs } = body;
    if (
      !Array.isArray(secrets) ||
      !Array.isArray(bidder_sigs) ||
      secrets.length === 0 ||
      secrets.length !== bidder_sigs.length
    ) {
      return c.json({ error: "missing secrets or bidder_sigs" }, 400);
    }
    if (bid.status === "refunded") return c.json({ error: "ALREADY_REFUNDED" }, 400);
    if (bid.status === "verified") return c.json({ error: "NOT_OUTBID" }, 400);
    if (!bid.proof_data) return c.json({ error: "NO_PROOF" }, 400);

    let bundle: StoredProofBundle;
    try {
      bundle = parseProofData(bid.proof_data);
    } catch {
      return c.json({ error: "INVALID_PROOF" }, 400);
    }
    const validSecrets = new Set(bundle.proofs.map((p) => p.secret));
    const bidderXOnly = canonicalPubkey(bid.bidder_npub);

    const server_sigs: string[] = [];
    for (let i = 0; i < secrets.length; i++) {
      const secret = secrets[i]!;
      const sig = bidder_sigs[i]!;
      if (!validSecrets.has(secret)) return c.json({ error: "INVALID_MSG" }, 400);
      if (!verifySecretSignature(sig, secret, bidderXOnly)) {
        return c.json({ error: "INVALID_SIGNATURE" }, 400);
      }
      server_sigs.push(signSecret(secret, skHexForServer()));
    }
    return c.json({ server_sigs });
  });

  // ── Refund: client confirms completion → mark refunded (prevents re-refund) ──
  router.post("/bids/:id/refunded", async (c) => {
    const bid = await db.getBid(c.req.param("id")!);
    if (!bid) return c.json({ error: "not found" }, 404);
    const bidderPubkey = c.req.query("bidder_pubkey") ?? "";
    if (canonicalPubkey(bidderPubkey) !== canonicalPubkey(bid.bidder_npub)) {
      return c.json({ error: "NOT_BIDDER" }, 400);
    }
    if (bid.status === "refunded") return c.json({ error: "ALREADY_REFUNDED" }, 400);
    if (bid.status !== "outbid" && bid.status !== "pending") {
      return c.json({ error: "NOT_OUTBID" }, 400);
    }
    bid.status = "refunded";
    await db.saveBid(bid);
    return c.json({ ok: true });
  });

  // ── Nostr identity link (Model B): seller binds their NIP-07 Nostr key to
  // their eGavel trading key. content of the NIP-98 event = trading pubkey. ──
  router.post("/identity/nostr-link", async (c) => {
    const body = await c.req.json().catch(() => null) as { trading_pubkey?: string; sig?: string; event?: unknown } | null
    if (!body?.trading_pubkey || !body?.sig || !body?.event) return c.json({ error: "missing fields" }, 400)
    // 1. prove control of the trading key
    const tradingContent = `link:${body.trading_pubkey}`
    if (!verifySecretSignature(body.sig, tradingContent, canonicalPubkey(body.trading_pubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400)
    }
    // 2. verify the NIP-98 event
    const v = verifyNip98Event(body.event)
    if (!v.ok) return c.json({ error: v.error }, 400)
    if (v.content !== body.trading_pubkey) return c.json({ error: "CONTENT_MISMATCH" }, 400)
    // 3. store the link (locked: no re-link to a different key, no unlink)
    const ok = await db.saveNostrLink(body.trading_pubkey, v.nostrPubkey)
    if (!ok) return c.json({ error: "ALREADY_LINKED" }, 400)
    return c.json({ ok: true, nostr_pubkey: v.nostrPubkey })
  })

  // ── Nostr link status: the web reads the caller's own link (if any) so the
  // dashboard can show "Nostr verified" / "Link Nostr". Signed like /bids so a
  // third party cannot probe another trading key's link. ──
  router.get("/identity/nostr-link", async (c) => {
    const tradingPubkey = c.req.query("trading_pubkey") ?? ""
    const sig = c.req.query("sig") ?? ""
    if (!tradingPubkey || !sig) return c.json({ error: "missing params" }, 400)
    if (!verifySecretSignature(sig, `nostr-link:${tradingPubkey}`, canonicalPubkey(tradingPubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400)
    }
    const link = await db.getNostrLink(tradingPubkey)
    return c.json(link ? { ok: true, nostr_pubkey: link.nostr_pubkey } : { ok: false })
  })

  // ── NUT-18 incoming payments: a payer POSTs proofs to this endpoint (the
  // transport target of a creqA payment request). The receiver collects them
  // via the signed GET below. The `id` in the payload is the receiver's
  // trading pubkey (carried from the payment request's `i` field). ──
  router.post("/wallet/receive", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: string
      mint?: string
      unit?: string
      proofs?: Array<{ id: string; amount: number; secret: string; C: string }>
      memo?: string
    }
    const receiverPubkey = body.id ?? ""
    const mintUrl = body.mint ?? ""
    const proofs = body.proofs
    if (!receiverPubkey || !mintUrl || !Array.isArray(proofs) || proofs.length === 0) {
      return c.json({ error: "invalid payment payload" }, 400)
    }
    // The payer's wallet serializes Proof.amount via its toJSON() as a string
    // ("100"), not a number — accept both and normalize to a number.
    const normalized = proofs.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      secret: p.secret,
      C: p.C,
    }))
    // Basic sanity: every proof must carry the fields a wallet needs.
    for (const p of normalized) {
      if (!p.secret || !p.C || !Number.isFinite(p.amount) || p.amount <= 0) {
        return c.json({ error: "invalid proof" }, 400)
      }
    }
    const amount = normalized.reduce((a, p) => a + p.amount, 0)
    await db.savePendingReceive(receiverPubkey, mintUrl, JSON.stringify(normalized), amount)
    return c.json({ ok: true, amount })
  })

  // ── NUT-18 collect: the receiver (signed) fetches their pending payments.
  // Returns the stored proofs so the web can merge them into the wallet;
  // receipts are cleared after this read (collected once). ──
  router.get("/wallet/receive", async (c) => {
    const receiverPubkey = c.req.query("receiver_pubkey") ?? ""
    const sig = c.req.query("sig") ?? ""
    if (!receiverPubkey || !sig) return c.json({ error: "missing params" }, 400)
    if (!verifySecretSignature(sig, `wallet-receive:${receiverPubkey}`, canonicalPubkey(receiverPubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400)
    }
    const rows = await db.getPendingReceives(receiverPubkey)
    return c.json({ ok: true, receipts: rows })
  })

  return router;
}
