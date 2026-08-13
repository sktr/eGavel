import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { compressImage } from "./image"

class FakeImage {
  naturalWidth = 1600
  naturalHeight = 800
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_v: string) {
    queueMicrotask(() => this.onload?.())
  }
}

class FakeFileReader {
  result: string | null = "data:image/png;base64,AAAA"
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL() {
    queueMicrotask(() => this.onload?.())
  }
}

// Single shared canvas instance: compressImage mutates the element it gets from
// createElement, and the tests assert on that same mutated object — so every
// createElement("canvas") call must return the SAME instance, not a fresh one.
const fakeCanvasEl = {
  width: 0,
  height: 0,
  getContext: () => ({ drawImage: vi.fn() }),
  toDataURL: (type: string, quality: number) => `data:${type};base64,fake-${quality}`,
}

describe("compressImage", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", FakeFileReader)
    vi.stubGlobal("Image", FakeImage)
    vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "canvas" ? fakeCanvasEl : {}),
    })
    fakeCanvasEl.width = 0
    fakeCanvasEl.height = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it("downscales a large image to maxEdge and returns a webp data URL", async () => {
    const out = await compressImage({} as File, 800)
    expect(out).toBe("data:image/webp;base64,fake-0.8")
    const canvas = document.createElement("canvas") as { width: number; height: number }
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(400)
  })

  it("keeps a small image at native size", async () => {
    // naturalWidth/naturalHeight are 1600x800, so request a bigger edge
    const out = await compressImage({} as File, 2000)
    expect(out).toBe("data:image/webp;base64,fake-0.8")
    const canvas = document.createElement("canvas") as { width: number; height: number }
    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(800)
  })

  it("returns null when the image fails to load", async () => {
    class BrokenImage {
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal("Image", BrokenImage)
    const out = await compressImage({} as File, 800)
    expect(out).toBeNull()
  })
})
