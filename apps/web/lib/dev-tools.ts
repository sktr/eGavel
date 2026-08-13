// Dev/debug tooling (Test Mode, the Get Sats faucet, and the mint override)
// is shown only when explicitly enabled via NEXT_PUBLIC_DEV_TOOLS=1 — it is
// never shown in production builds. Real deployments only expose the real
// token flows.
export const DEV_TOOLS = process.env.NEXT_PUBLIC_DEV_TOOLS === "1"
