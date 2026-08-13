import { describe, it, expect } from "vitest"
import { placeholderFor, itemInitial, CATEGORY_PLACEHOLDERS } from "./placeholder"

describe("placeholderFor", () => {
  it("maps every category to an icon + colors", () => {
    for (const cat of [
      "art",
      "collectibles",
      "watches",
      "bags",
      "jewelry",
      "wine",
      "cars",
      "furniture",
      "electronics",
      "other",
    ]) {
      const p = placeholderFor(cat)
      expect(p.icon).toBeTruthy()
      expect(p.bg).toBeTruthy()
      expect(p.fg).toBeTruthy()
    }
  })

  it("falls back to the neutral style for unknown/empty categories", () => {
    expect(placeholderFor()).toEqual(CATEGORY_PLACEHOLDERS.other)
    expect(placeholderFor("nonexistent")).toEqual(CATEGORY_PLACEHOLDERS.other)
  })
})

describe("itemInitial", () => {
  it("returns the uppercased first character", () => {
    expect(itemInitial("Rolex Submariner")).toBe("R")
    expect(itemInitial("  hello")).toBe("H")
  })
  it("falls back to '?' for empty input", () => {
    expect(itemInitial()).toBe("?")
    expect(itemInitial("   ")).toBe("?")
  })
})
