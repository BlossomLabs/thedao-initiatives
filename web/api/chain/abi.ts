import { hexToBytes, selector } from "./keccak.ts";
import { encodeHex } from "@std/encoding";

export function decodeHexInt(h: unknown): bigint {
  if (h === null || h === undefined || h === "" || h === "0x") return 0n;
  return BigInt(String(h));
}

/** Split an ABI return blob into 32-byte words. */
export function decodeWords(h: unknown): bigint[] {
  if (!h || h === "0x") return [];
  const raw = hexToBytes(String(h));
  const out: bigint[] = [];
  for (let i = 0; i + 32 <= raw.length; i += 32) {
    out.push(BigInt("0x" + encodeHex(raw.slice(i, i + 32))));
  }
  return out;
}

export const asInt256 = (w: bigint): bigint => (w >= 1n << 255n ? w - (1n << 256n) : w);

/** Decode a solidity `string` return value (also tolerates bytes32). */
export function decodeString(h: unknown): string {
  if (!h || h === "0x") return "";
  const raw = hexToBytes(String(h));
  const dec = new TextDecoder();
  if (raw.length === 32) {
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;
    return dec.decode(raw.slice(0, end));
  }
  if (raw.length >= 64) {
    const offset = Number(BigInt("0x" + encodeHex(raw.slice(0, 32))));
    if (offset + 32 <= raw.length) {
      const len = Number(BigInt("0x" + encodeHex(raw.slice(offset, offset + 32))));
      return dec.decode(raw.slice(offset + 32, offset + 32 + len));
    }
  }
  return "";
}

/** One 32-byte ABI word from a bigint/number or a 0x-address string. */
export function abiWord(v: string | bigint | number): Uint8Array {
  const out = new Uint8Array(32);
  if (typeof v === "string") {
    out.set(hexToBytes(v.toLowerCase().replace(/^0x/, "").padStart(40, "0")), 12);
    return out;
  }
  let n = BigInt(v);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const SEL_CREATE_PROXY = selector("createProxyWithNonce(address,bytes,uint256)");
export const SEL_SETUP = selector(
  "setup(address[],uint256,address,bytes,address,address,uint256,address)",
);
export const SEL_GET_OWNERS = selector("getOwners()");
export const SEL_GET_THRESHOLD = selector("getThreshold()");
export const SEL_DECIMALS = selector("decimals()");
export const SEL_SYMBOL = selector("symbol()");
export const SEL_BALANCE_OF = selector("balanceOf(address)");
export const SEL_LATEST_ROUND_DATA = selector("latestRoundData()");

const ZERO = "0x" + "0".repeat(40);

/** ABI-encode Safe.setup(owners, threshold, 0, 0x, handler, 0, 0, 0). */
export function encodeSafeSetup(
  owners: string[],
  threshold: number,
  fallbackHandler: string,
): Uint8Array {
  const headSize = 8 * 32;
  const ownersTail = concat(abiWord(owners.length), ...owners.map((o) => abiWord(o)));
  const ownersOff = headSize;
  const dataOff = ownersOff + ownersTail.length;
  const head = concat(
    abiWord(ownersOff),
    abiWord(threshold),
    abiWord(ZERO),
    abiWord(dataOff),
    abiWord(fallbackHandler),
    abiWord(ZERO),
    abiWord(0),
    abiWord(ZERO),
  );
  return concat(hexToBytes(SEL_SETUP), head, ownersTail, abiWord(0));
}

/** Calldata for SafeProxyFactory.createProxyWithNonce. */
export function encodeCreateProxy(
  singleton: string,
  initializer: Uint8Array,
  saltNonce: bigint,
): string {
  const headSize = 3 * 32;
  const pad = (32 - (initializer.length % 32)) % 32;
  const initTail = concat(abiWord(initializer.length), initializer, new Uint8Array(pad));
  const head = concat(abiWord(singleton), abiWord(headSize), abiWord(saltNonce));
  return SEL_CREATE_PROXY + encodeHex(concat(head, initTail));
}
