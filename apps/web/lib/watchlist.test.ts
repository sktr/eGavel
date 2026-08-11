import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { loadWatchlist, saveWatchlist, toggleId } from "./watchlist"

describe("watchlist storage helpers", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it("loads an empty list by default", () => {
    expect(loadWatchlist()).toEqual([])
  })

  it("toggleId adds and removes ids", () => {
    expect(toggleId([], "a1")).toEqual(["a1"])
    expect(toggleId(["a1"], "a1")).toEqual([])
  })

  it("saveWatchlist round-trips", () => {
    saveWatchlist(["a1", "a2"])
    expect(loadWatchlist()).toEqual(["a1", "a2"])
  })
})
