import type { MiddlewareHandler } from "hono"

export function rateLimit({ windowMs, max }: { windowMs: number; max: number }): MiddlewareHandler {
  const hits = new Map<string, number[]>()
  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown"
    const now = Date.now()
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
    if (arr.length >= max) {
      return c.json({ error: "rate limit exceeded" }, 429)
    }
    arr.push(now)
    hits.set(ip, arr)
    await next()
  }
}
