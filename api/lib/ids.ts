import { ulid } from "@std/ulid";
import { encodeBase64Url, encodeHex } from "@std/encoding";
import { sha256, stringToBytes } from "viem";
import { generateSiweNonce } from "viem/siwe";

export const newId = (): string => ulid();

export function randomToken(bytes = 32): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomHex(bytes = 16): string {
  return encodeHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** EIP-4361 nonce (96 hex chars from viem). */
export const randomNonce = (): string => generateSiweNonce();

export function sha256Hex(text: string | Uint8Array): string {
  const bytes = typeof text === "string" ? stringToBytes(text) : text;
  return sha256(bytes).slice(2);
}
