/** Hashing and hex helpers, all backed by viem. */
import {
  bytesToHex as viemBytesToHex,
  type Hex,
  hexToBytes as viemHexToBytes,
  keccak256 as viemKeccak256,
  stringToBytes,
  toEventSelector,
  toFunctionSelector,
} from "viem";

export const keccak256 = (data: Uint8Array): Uint8Array => viemKeccak256(data, "bytes");
export const keccakHex = (data: Uint8Array): string => viemKeccak256(data);
export const utf8 = (s: string): Uint8Array => stringToBytes(s);

/** Accepts hex with or without the 0x prefix (odd lengths are left-padded). */
export const hexToBytes = (h: string): Uint8Array =>
  viemHexToBytes((h.startsWith("0x") ? h : "0x" + h) as Hex);

export const bytesToHex = (b: Uint8Array): string => viemBytesToHex(b);

/** Function selector / event topic from a signature string. */
export const selector = (sig: string): string => toFunctionSelector(sig);
export const eventTopic = (sig: string): string => toEventSelector(sig);
