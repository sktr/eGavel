// Hex helpers (runtime-agnostic: Node + Workers).
const HEX = "0123456789abcdef";
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX.charAt(b >> 4) + HEX.charAt(b & 15);
  return out;
}
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
