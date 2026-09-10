import { getAddress, isAddress as viemIsAddress } from "viem";

/** EIP-55 checksum encoding. Throws on anything that is not 20 hex bytes. */
export const toChecksum = (addr: string): string => getAddress(String(addr));

/** 20 hex bytes in any casing (a wrong mixed-case checksum is still an address). */
export const isAddress = (s: unknown): s is string =>
  typeof s === "string" && viemIsAddress(s, { strict: false });

export const addrEq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** 32-byte topic form of an address (for log filters / comparisons). */
export const addressTopic = (addr: string): string =>
  "0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "");
