import { describe, it, expect, beforeEach } from "vitest";
import { storeProofsInWallet, WALLET_CHANGED_EVENT } from "./wallet";
import type { Proof } from "@cashu/cashu-ts";

// window is undefined in the node test env; stub just enough for the event
// dispatcher that lives in wallet.ts.
const originalWindow = (globalThis as Record<string, unknown>).window;

function stubWindow() {
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

function restoreWindow() {
  if (originalWindow === undefined) {
    delete (globalThis as Record<string, unknown>).window;
  } else {
    (globalThis as Record<string, unknown>).window = originalWindow;
  }
}

describe("wallet change notification", () => {
  beforeEach(() => {
    localStorage.clear();
    restoreWindow();
  });

  it("storeProofsInWallet dispatches WALLET_CHANGED_EVENT so the header balance refreshes", () => {
    const listeners = stubWindow();
    let fired = 0;
    (globalThis as unknown as { window: { addEventListener: (t: string, f: () => void) => void } }).window.addEventListener(
      WALLET_CHANGED_EVENT,
      () => {
        fired += 1;
      },
    );
    void listeners; // stubWindow returns the map for future assertions

    storeProofsInWallet([] as Proof[], "https://mint.example");

    expect(fired).toBe(1);
  });

  it("does not throw when window is unavailable (SSR / node)", () => {
    expect(() => storeProofsInWallet([] as Proof[], "https://mint.example")).not.toThrow();
  });
});
