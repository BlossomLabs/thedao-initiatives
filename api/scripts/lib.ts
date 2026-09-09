/** Shared bits for the dev scripts: a local signing wallet and a SIWE login. */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { encodeHex } from "@std/encoding";
import { keccak256 } from "../chain/keccak.ts";
import { toChecksum } from "../chain/address.ts";
import { personalMessageHash } from "../chain/sign.ts";
import { createSiweMessage } from "../chain/siwe.ts";

export function walletFromHex(privHex: string) {
  const clean = privHex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error("private key must be 32 bytes of hex");
  }
  const priv = new Uint8Array(32);
  for (let i = 0; i < 32; i++) priv[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  const pub = secp256k1.getPublicKey(priv, false);
  const address = toChecksum("0x" + encodeHex(keccak256(pub.slice(1)).slice(-20)));
  return {
    address,
    sign(message: string): string {
      const sig = secp256k1.sign(personalMessageHash(message), priv, {
        prehash: false,
        format: "recovered",
      });
      return "0x" + encodeHex(sig.slice(1)) + (sig[0] + 27).toString(16).padStart(2, "0");
    },
  };
}

export interface LoginOptions {
  apiUrl: string;
  webOrigin: string;
  privateKey: string;
}

/** nonce -> SIWE message -> personal_sign -> verify. Returns the bearer token. */
export async function siweLogin(
  o: LoginOptions,
): Promise<{ token: string; address: string; isAdmin: boolean }> {
  const w = walletFromHex(o.privateKey);
  const nonceRes = await fetch(o.apiUrl + "/api/auth/nonce", {
    headers: { Origin: o.webOrigin },
  });
  if (!nonceRes.ok) {
    throw new Error(`nonce failed: ${nonceRes.status} ${await nonceRes.text()}`);
  }
  const { nonce } = await nonceRes.json() as { nonce: string };
  const message = createSiweMessage({
    domain: new URL(o.webOrigin).host,
    address: w.address,
    uri: o.webOrigin,
    nonce,
    issuedAt: new Date().toISOString(),
    statement: "Sign in to TheDAO Security Fund",
  });
  const res = await fetch(o.apiUrl + "/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: o.webOrigin },
    body: JSON.stringify({ message, signature: w.sign(message) }),
  });
  if (!res.ok) throw new Error(`verify failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

export const env = (k: string, d = ""): string => (Deno.env.get(k) ?? d).trim();
