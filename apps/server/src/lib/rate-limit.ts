import type { MiddlewareHandler } from "hono"

export interface RateLimitOptions {
  windowMs: number
  max: number
  /** Restrict counting to these HTTP methods. Absent = all methods. */
  methods?: string[]
}

export function rateLimit({ windowMs, max, methods }: RateLimitOptions): MiddlewareHandler {
  const hits = new Map<string, number[]>()
  return async (c, next) => {
    if (methods && !methods.includes(c.req.method)) {
      return next()
    }
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown"
    // Separate buckets per method so reads (e.g. dashboard GET /api/bids)
    // don't consume the same budget as writes.
    const key = `${c.req.method}:${ip}`
    const now = Date.now()
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (arr.length >= max) {
      return c.json({ error: "rate limit exceeded" }, 429)
    }
    arr.push(now)
    hits.set(key, arr)
    await next()
  }
}
