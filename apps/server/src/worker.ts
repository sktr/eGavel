import type { D1Database } from "@cloudflare/workers-types";
import { createApp } from "./app.js";
import { createD1Db } from "./db/d1.js";

export interface Env {
  egavel_db: D1Database;
  SERVER_PRIVATE_KEY?: string;
  AUCTION_FEE_BPS?: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const db = createD1Db(env.egavel_db);
    const app = createApp(db, {
      serverKey: env.SERVER_PRIVATE_KEY,
      feeBps: env.AUCTION_FEE_BPS ? Number(env.AUCTION_FEE_BPS) : undefined,
    });
    return app.fetch(request);
  },
};
