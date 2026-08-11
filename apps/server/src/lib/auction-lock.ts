type Mutex = {
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      const prev = tail
      tail = prev.then(() => gate)
      await prev
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

const mutexes = new Map<string, Mutex>()

/** Serializes async work per auction id within this process. */
export function withAuctionLock<T>(auctionId: string, fn: () => Promise<T>): Promise<T> {
  let m = mutexes.get(auctionId)
  if (!m) {
    m = createMutex()
    mutexes.set(auctionId, m)
  }
  return m.run(fn)
}
