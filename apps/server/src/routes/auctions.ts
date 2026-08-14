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
import { toPublicBid } from "../lib/public-bid.js";
import { auctionFeeBps } from "../lib/auction-fee.js";
import { settleIfDue } from "../lib/settle.js";

export interface AuctionRoutesConfig {
  serverKey?: string;
  feeBps?: number;
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
    const listed = settled.map((a) =>
      a.images ? { ...a, images: a.images.slice(0, 1) } : a,
    );
    return c.json(listed);
  });

  // ── Delete listing: seller removes a bid-less auction (a mistaken listing) ──
  router.delete("/auctions/:id", async (c) => {
    const id = c.req.param("id")!
    const auction = await db.getAuction(id)
    if (!auction) return c.json({ error: "not found" }, 404)
    const sellerPubkey = c.req.query("seller_pubkey") ?? ""
    if (canonicalPubkey(sellerPubkey) !== canonicalPubkey(auction.seller_pubkey)) {
      return c.json({ error: "NOT_SELLER" }, 400)
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
    if (!Number.isFinite(startPrice) || startPrice <= 0) {
      return c.json({ error: "start_price must be a positive number" }, 400);
    }
    if (!Number.isFinite(endTime) || endTime <= Date.now()) {
      return c.json({ error: "end_time must be in the future" }, 400);
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

    const auction: Auction = {
      id: `${sellerPubkey}-${Date.now()}`,
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
    return c.json(auction);
  });

  router.get("/auctions/:id", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    const settled = await settleIfDue(db, auction);
    // Combined read for the detail page's live poll: one request instead of
    // two (auction + bids), halving polling load (adaptive-backoff client).
    if (c.req.query("with_bids") === "1") {
      const bids = (await db.getVerifiedBids(auction.id)).map(toPublicBid);
      return c.json({ auction: settled, bids });
    }
    return c.json(settled);
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
    return c.json({ ok: true });
  });

  router.get("/bids", async (c) => {
    const bidderPubkey = c.req.query("bidder_pubkey");
    if (!bidderPubkey) {
      return c.json({ error: "bidder_pubkey query param required" }, 400);
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
    const { sellerNet, fee, change } = computeClaimSplit(totalInput, winningAmount, feeBps);

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

      return c.json({ seller_proofs: sellerProofs, fee, change });
    } catch (err) {
      return c.json(
        { error: `claim swap failed: ${err instanceof Error ? err.message : String(err)}` },
        500,
      );
    }
  });

  // ── Change: the winner collects the excess (locked max − standing price)
  // returned during the seller's claim swap (proxy bidding) ──
  router.get("/auctions/:id/change", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    const bidderPubkey = c.req.query("bidder_pubkey") ?? "";
    const change = await db.getChange(auction.id);
    if (!change) return c.json({ error: "NO_CHANGE" }, 400);
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

  // ── Checkout: winner registers a shipping address.
  // Auth = Schnorr signature over the payload string (same scheme as P2PK). ──
  router.post("/auctions/:id/shipping", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    let body: {
      auction_id?: string;
      address?: string;
      note?: string | null;
      pubkey?: string;
      sig?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const { auction_id, address, note, pubkey, sig } = body;
    if (!auction_id || !address || !pubkey || !sig) {
      return c.json({ error: "missing auction_id, address, pubkey, sig" }, 400);
    }
    if (auction_id !== auction.id) return c.json({ error: "INVALID_CONTENT" }, 400);
    if (!auction.winner_npub || canonicalPubkey(pubkey) !== canonicalPubkey(auction.winner_npub)) {
      return c.json({ error: "NOT_WINNER" }, 400);
    }
    const content = JSON.stringify({ auction_id, address, note: note ?? null });
    if (!verifySecretSignature(sig, content, canonicalPubkey(pubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400);
    }
    await db.saveShipping(auction.id, address, note ?? null);
    return c.json({ ok: true });
  });

  router.get("/auctions/:id/shipping", async (c) => {
    const auction = await db.getAuction(c.req.param("id")!);
    if (!auction) return c.json({ error: "not found" }, 404);
    const sellerPubkey = c.req.query("seller_pubkey") ?? "";
    if (canonicalPubkey(sellerPubkey) !== canonicalPubkey(auction.seller_pubkey)) {
      return c.json({ error: "NOT_SELLER" }, 400);
    }
    const shipping = await db.getShipping(auction.id);
    return c.json(shipping ?? { address: null, note: null });
  });

  return router;
}
