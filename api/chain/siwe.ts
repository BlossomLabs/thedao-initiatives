/** Sign-In with Ethereum (EIP-4361) on top of viem/siwe: the parser is viem's,
 * this file only insists on the required fields and applies our policy
 * (allowed domains/origins, chain, clock skew) before recovering the signer.
 * EOA signatures are checked locally; when that fails and an RPC is given,
 * the message address is asked via EIP-1271 (Safes, smart wallets). */
import type { Hex } from "viem";
import { parseSiweMessage as viemParse, validateSiweMessage } from "viem/siwe";
import { addrEq, toChecksum } from "./address.ts";
import type { Rpc } from "./rpc.ts";
import { isValidContractSignature, recoverPersonalSign } from "./sign.ts";

export interface SiweMessage {
  scheme?: string;
  domain: string;
  address: Hex;
  statement?: string;
  uri: string;
  version: "1";
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expirationTime?: Date;
  notBefore?: Date;
  requestId?: string;
  resources: string[];
}

/** Parse the EIP-4361 text. Throws with a reason when a required field is missing or malformed. */
export function parseSiweMessage(text: string): SiweMessage {
  const p = viemParse(String(text));
  const need = <T>(name: string, v: T | undefined): T => {
    if (v === undefined || v === "") throw new Error(`missing ${name}`);
    return v;
  };
  const version = need("Version", p.version);
  if (version !== "1") throw new Error("unsupported version");
  const m: SiweMessage = {
    scheme: p.scheme,
    domain: need("domain", p.domain),
    address: toChecksum(need("address", p.address)) as Hex,
    statement: p.statement,
    uri: need("URI", p.uri),
    version,
    chainId: need("Chain ID", p.chainId),
    nonce: need("Nonce", p.nonce),
    issuedAt: need("Issued At", p.issuedAt),
    expirationTime: p.expirationTime,
    notBefore: p.notBefore,
    requestId: p.requestId,
    resources: p.resources ?? [],
  };
  for (const ts of [m.issuedAt, m.expirationTime, m.notBefore]) {
    if (ts !== undefined && Number.isNaN(ts.getTime())) throw new Error("bad timestamp");
  }
  return m;
}

export interface SiweVerifyInput {
  message: string;
  signature: string;
  domains: string[];
  origins: string[];
  chainId: number;
  now: number; // seconds
  skewSecs: number;
  /** Enables the EIP-1271 fallback; without it only EOA signatures verify. */
  rpc?: Rpc;
}

/** Verify everything except nonce freshness (the caller owns nonce storage). */
export async function verifySiwe(
  input: SiweVerifyInput,
): Promise<[SiweMessage, null] | [null, string]> {
  let m: SiweMessage;
  try {
    m = parseSiweMessage(input.message);
  } catch (e) {
    return [null, `malformed SIWE message: ${(e as Error).message}`];
  }
  if (!input.domains.includes(m.domain)) return [null, "domain not allowed"];
  let origin = "";
  try {
    origin = new URL(m.uri).origin;
  } catch {
    return [null, "bad uri"];
  }
  if (!input.origins.includes(origin)) return [null, "uri not allowed"];
  if (m.chainId !== input.chainId) return [null, "wrong chain"];
  if (Math.abs(input.now - m.issuedAt.getTime() / 1000) > input.skewSecs) {
    return [null, "issuedAt out of window"];
  }
  const time = new Date(input.now * 1000);
  if (!validateSiweMessage({ message: m, time })) {
    return [null, "message expired or not yet valid"];
  }
  const signer = await recoverPersonalSign(input.message, input.signature);
  if (signer && addrEq(signer, m.address)) return [m, null];
  if (
    input.rpc &&
    await isValidContractSignature(input.rpc, m.address, input.message, input.signature)
  ) {
    return [m, null];
  }
  return [null, "signature does not verify"];
}
