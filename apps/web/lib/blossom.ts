export type BlobDescriptor = {
  url: string
  sha256: string
  size: number
  type?: string
  uploaded?: number
}

export type Signer = {
  getPublicKey: () => Promise<string>
  signEvent: (template: {
    kind: number
    content: string
    tags: string[][]
    created_at: number
  }) => Promise<{ id: string; pubkey: string; sig: string; kind: number; content: string; tags: string[][]; created_at: number }>
}

function base64Encode(str: string): string {
  // Node / browser compatible
  if (typeof Buffer !== "undefined") return Buffer.from(str, "utf-8").toString("base64")
  return btoa(str)
}

export async function uploadToBlossom(
  file: File,
  signer: Signer,
  serverUrl = "https://blossom.primal.net",
): Promise<BlobDescriptor> {
  const normalizedUrl = serverUrl.replace(/\/+$/, "")

  // Build kind 24242 Blossom auth event (BUD-01)
  const authTemplate = {
    kind: 24242,
    content: `Upload ${file.name}`,
    tags: [
      ["t", "upload"],
      ["expiration", String(Math.floor(Date.now() / 1000) + 60)],
      ["name", file.name],
      ["size", String(file.size)],
    ],
    created_at: Math.floor(Date.now() / 1000),
  }

  const signed = await signer.signEvent(authTemplate as any)
  const auth = base64Encode(JSON.stringify(signed))

  const res = await fetch(`${normalizedUrl}/upload`, {
    method: "PUT",
    headers: {
      Authorization: `Nostr ${auth}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Blossom upload failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as BlobDescriptor
  return data
}
