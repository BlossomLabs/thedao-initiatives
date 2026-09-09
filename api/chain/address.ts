import { keccak256, utf8 } from "./keccak.ts";
import { encodeHex } from "@std/encoding";

/** EIP-55 checksum encoding. Throws on anything that is not 20 hex bytes. */
export function toChecksum(addr: string): string {
  const a = String(addr).toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(a)) throw new Error(`invalid address: ${addr}`);
  const h = encodeHex(keccak256(utf8(a)));
  let out = "";
  for (let i = 0; i < 40; i++) {
    const c = a[i];
    out += /[a-f]/.test(c) && parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c;
  }
  return "0x" + out;
}

export function isAddress(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    toChecksum(s);
    return true;
  } catch {
    return false;
  }
}

export const addrEq = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/** 32-byte topic form of an address (for log filters / comparisons). */
export const addressTopic = (addr: string): string =>
  "0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "");
