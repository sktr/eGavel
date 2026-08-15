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
import { toPublicBid } from "../lib/public-bid.js";
import { auctionFeeBps } from "../lib/auction-fee.js";
import { settleIfDue } from "../lib/settle.js";
import { isValidMintUrl } from "../lib/mint-url.js";

export interface AuctionRoutesConfig {
  serverKey?: string;
  feeBps?: number;
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
      const enriched = nostrLink ? { ...withPrice, seller_nostr_pubkey: nostrLink } : withPrice;
      // Winner links are rare in the active list (only settled winners), so a
      // per-row lookup is fine. Guard the empty-string case (no winner).
      const winnerNostrLink = a.winner_npub ? await db.getNostrLink(a.winner_npub) : null;
      const withWinner = winnerNostrLink
        ? { ...enriched, winner_nostr_pubkey: winnerNostrLink.nostr_pubkey }
        : enriched;
      listed.push(withWinner.images ? { ...withWinner, images: withWinner.images.slice(0, 1) } : withWinner);
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
    if (!Number.isFinite(startPrice) || startPrice <= 0) {
      return c.json({ error: "start_price must be a positive number" }, 400);
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
    // Seller's linked Nostr pubkey (if any) — gates the nostr.at seller link.
    const nostrLink = await db.getNostrLink(settled.seller_pubkey);
    const enriched = nostrLink
      ? { ...settled, seller_nostr_pubkey: nostrLink.nostr_pubkey }
      : settled;
    // Winner's linked Nostr pubkey (if any) — same link table, winner_npub key.
    const winnerNostrLink = settled.winner_npub
      ? await db.getNostrLink(settled.winner_npub)
      : null;
    const withWinner = winnerNostrLink
      ? { ...enriched, winner_nostr_pubkey: winnerNostrLink.nostr_pubkey }
      : enriched;
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
    // 3. store the link
    await db.saveNostrLink(body.trading_pubkey, v.nostrPubkey)
    return c.json({ ok: true, nostr_pubkey: v.nostrPubkey })
  })

  router.delete("/identity/nostr-link", async (c) => {
    const body = await c.req.json().catch(() => null) as { trading_pubkey?: string; sig?: string } | null
    if (!body?.trading_pubkey || !body?.sig) return c.json({ error: "missing fields" }, 400)
    if (!verifySecretSignature(body.sig, `unlink:${body.trading_pubkey}`, canonicalPubkey(body.trading_pubkey))) {
      return c.json({ error: "INVALID_SIGNATURE" }, 400)
    }
    await db.deleteNostrLink(body.trading_pubkey)
    return c.json({ ok: true })
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

  return router;
}
