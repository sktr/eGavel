const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"]

export async function publishAuditLog(
  event: unknown,
  relays: string[] = DEFAULT_RELAYS,
): Promise<void> {
  try {
    const { SimplePool } = await import("nostr-tools")
    const pool = new SimplePool()
    const pubs: Promise<string>[] = pool.publish(relays, event as never)
    await Promise.allSettled(pubs)
    pool.close(relays)
  } catch {
    // fire-and-forget: never throw
  }
}
