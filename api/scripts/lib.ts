/** Shared bits for the dev scripts: a local signing wallet and a SIWE login. */
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

export function walletFromHex(privHex: string) {
  const clean = privHex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error("private key must be 32 bytes of hex");
  }
  const account = privateKeyToAccount(("0x" + clean) as Hex);
  return {
    address: account.address as string,
    sign: (message: string): Promise<string> => account.signMessage({ message }),
  };
}

export interface LoginOptions {
  apiUrl: string;
  webOrigin: string;
  privateKey: string;
  /** Present the credential being renewed so verification atomically replaces it. */
  previousToken?: string;
}

/** Basic credentials for a site behind the private-preview lock (no session yet). */
export function siteLockHeader(): Record<string, string> {
  const u = env("SITE_USERNAME"), p = env("SITE_PASSWORD");
  return u && p ? { Authorization: "Basic " + btoa(`${u}:${p}`) } : {};
}

/** nonce -> SIWE message -> personal_sign -> verify. Returns the bearer token. */
export async function siweLogin(
  o: LoginOptions,
): Promise<{ token: string; address: string; isAdmin: boolean }> {
  const w = walletFromHex(o.privateKey);
  const nonceRes = await fetch(o.apiUrl + "/api/auth/nonce", {
    headers: { Origin: o.webOrigin, ...siteLockHeader() },
  });
  if (!nonceRes.ok) {
    throw new Error(`nonce failed: ${nonceRes.status} ${await nonceRes.text()}`);
  }
  const { nonce } = await nonceRes.json() as { nonce: string };
  const message = createSiweMessage({
    domain: new URL(o.webOrigin).host,
    address: w.address as Hex,
    uri: o.webOrigin,
    version: "1",
    chainId: 1,
    nonce,
    issuedAt: new Date(),
    statement: "Sign in to TheDAO Security Fund",
  });
  const res = await fetch(o.apiUrl + "/api/auth/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: o.webOrigin,
      ...siteLockHeader(),
      ...(o.previousToken ? { Authorization: "Bearer " + o.previousToken } : {}),
    },
    body: JSON.stringify({ message, signature: await w.sign(message) }),
  });
  if (!res.ok) throw new Error(`verify failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

export const env = (k: string, d = ""): string => (Deno.env.get(k) ?? d).trim();
