import "dotenv/config"
import { serve } from "@hono/node-server"
import { initDb } from "./db/index.js"
import { createScheduler } from "./scheduler/index.js"
import { createApp } from "./app.js"

const db = initDb()
const scheduler = createScheduler(db)
const app = createApp(db)

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, () => {
  console.log(`server running on :${port}`)

  scheduler.start()

  const shutdown = () => {
    scheduler.stop()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
})
