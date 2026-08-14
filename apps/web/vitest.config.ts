import { defineConfig } from "vite-plus"

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
})
