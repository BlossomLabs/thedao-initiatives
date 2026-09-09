import { keccak_256 } from "@noble/hashes/sha3.js";
import { decodeHex, encodeHex } from "@std/encoding";

export const keccak256 = (data: Uint8Array): Uint8Array => keccak_256(data);
export const keccakHex = (data: Uint8Array): string => "0x" + encodeHex(keccak_256(data));
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  return decodeHex(s.length % 2 ? "0" + s : s);
}

export const bytesToHex = (b: Uint8Array): string => "0x" + encodeHex(b);

/** Function selector / event topic from a signature string. */
export const selector = (sig: string): string => keccakHex(utf8(sig)).slice(0, 10);
export const eventTopic = (sig: string): string => keccakHex(utf8(sig));
