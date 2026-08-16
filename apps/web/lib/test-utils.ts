/**
 * Shared test helpers for the web suite.
 *
 * vitest picks up only `lib/**&#47;*.test.ts` (see vitest.config.ts), so this
 * file (no `.test.ts` suffix) is never collected as a test file itself.
 */

const originalWindow = (globalThis as Record<string, unknown>).window;

/**
 * Stub `window` with a minimal event-target so components that dispatch
 * WALLET_CHANGED_EVENT (wallet.ts) work in the node test env. Returns the
 * listener map for assertions.
 */
export function stubWindow() {
  const listeners = new Map<string, Set<() => void>>();
  (globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (ev: Event) => {
      listeners.get(ev.type)?.forEach((fn) => fn());
      return true;
    },
  };
  return listeners;
}

/** Restore the original window (or remove the stub when there was none). */
export function restoreWindow() {
  if (originalWindow === undefined) {
    delete (globalThis as Record<string, unknown>).window;
  } else {
    (globalThis as Record<string, unknown>).window = originalWindow;
  }
}

/** Minimal fetch Response helper for stubbing endpoints. */
export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
