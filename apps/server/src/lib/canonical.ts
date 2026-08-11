/** Normalize a pubkey to lowercase x-only (last 64 hex chars). */
export function canonicalPubkey(pk: string): string {
  const clean = pk.trim().toLowerCase()
  // strip 02/03 SEC1 prefix if present
  const x = clean.length === 66 ? clean.slice(2) : clean
  return x
}
