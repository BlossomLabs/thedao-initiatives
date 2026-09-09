import { ulid } from "@std/ulid";
import { encodeBase64Url, encodeHex } from "@std/encoding";
import { sha256 } from "@noble/hashes/sha2.js";

export const newId = (): string => ulid();

export function randomToken(bytes = 32): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomHex(bytes = 16): string {
  return encodeHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** EIP-4361 nonce: at least 8 alphanumerics. */
export function randomNonce(len = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of buf) out += ALNUM[b % ALNUM.length];
  return out;
}

export function sha256Hex(text: string | Uint8Array): string {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  return encodeHex(sha256(bytes));
}
