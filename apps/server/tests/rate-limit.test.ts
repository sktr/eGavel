import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import { rateLimit } from "../src/lib/rate-limit.js"

describe("rateLimit", () => {
  it("allows up to max requests then returns 429", async () => {
    const app = new Hono()
    app.use("*", rateLimit({ windowMs: 60_000, max: 3 }))
    app.get("/", (c) => c.text("ok"))

    const r1 = await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } })
    const r2 = await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } })
    const r3 = await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } })
    const r4 = await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r3.status).toBe(200)
    expect(r4.status).toBe(429)
  })

  it("treats different IPs separately", async () => {
    const app = new Hono()
    app.use("*", rateLimit({ windowMs: 60_000, max: 1 }))
    app.get("/", (c) => c.text("ok"))
    expect((await app.request("http://localhost/", { headers: { "x-forwarded-for": "1.1.1.1" } })).status).toBe(200)
    expect((await app.request("http://localhost/", { headers: { "x-forwarded-for": "2.2.2.2" } })).status).toBe(200)
  })
})
