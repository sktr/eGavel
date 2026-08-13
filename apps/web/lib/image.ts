/**
 * Read an image File, downscale the longer edge to `maxEdge` px, and return a
 * WebP data URL (quality 0.8). Returns null when the file cannot be decoded.
 */
export async function compressImage(
  file: File,
  maxEdge = 800,
): Promise<string | null> {
  try {
    const dataUrl = await readAsDataURL(file)
    if (!dataUrl) return null
    const img = await loadImage(dataUrl)
    if (!img || !img.naturalWidth || !img.naturalHeight) return null

    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, width, height)

    try {
      return canvas.toDataURL("image/webp", 0.8)
    } catch {
      return canvas.toDataURL("image/jpeg", 0.8)
    }
  } catch {
    return null
  }
}

function readAsDataURL(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
