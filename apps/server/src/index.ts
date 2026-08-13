import "dotenv/config"
import { serve } from "@hono/node-server"
import { initDb } from "./db/index.js"
import { createApp } from "./app.js"

const db = initDb()
const app = createApp(db)

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, () => {
  console.log(`server running on :${port}`)
})
