import { DEV_TOOLS } from "./dev-tools";

/**
 * The single mint the app uses.
 *
 * Dev builds use the testnet mint; production is fixed to the minibits mint.
 * Keeping one mint for the whole app means wallets, auctions and recovery
 * never mix mints (a fixed mint also makes seed recovery automatic — there is
 * only one place to scan). Introduce multi-mint support deliberately later,
 * together with per-mint wallet UX.
 */
export const DEFAULT_MINT = DEV_TOOLS
  ? "https://testnut.cashu.space"
  : "https://mint.minibits.cash/Bitcoin";

/** Dev-only test mint for Test Mode bids (no real tokens). */
export const TEST_MINT_URL = "test://local";
