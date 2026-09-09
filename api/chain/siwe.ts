/** Sign-In with Ethereum (EIP-4361): strict message parser + verification. */
import { isAddress, toChecksum } from "./address.ts";
import { recoverPersonalSign } from "./sign.ts";

export interface SiweMessage {
  scheme?: string;
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources: string[];
}

const HEADER_RE =
  /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):\/\/)?([^ ]+) wants you to sign in with your Ethereum account:$/;

/** Parse the EIP-4361 text. Throws with a reason on any deviation. */
export function parseSiweMessage(text: string): SiweMessage {
  const lines = String(text).split("\n");
  let i = 0;
  const header = HEADER_RE.exec(lines[i++] ?? "");
  if (!header) throw new Error("bad header line");
  const [, scheme, domain] = header;
  const address = lines[i++] ?? "";
  if (!isAddress(address)) throw new Error("bad address line");
  if (lines[i++] !== "") throw new Error("expected blank line after address");
  let statement: string | undefined;
  if (lines[i] !== "" && lines[i] !== undefined && !lines[i].startsWith("URI: ")) {
    statement = lines[i++];
    if (lines[i++] !== "") throw new Error("expected blank line after statement");
  } else if (lines[i] === "") {
    i++;
  }
  const field = (name: string, required = false): string | undefined => {
    const line = lines[i];
    if (line !== undefined && line.startsWith(name + ": ")) {
      i++;
      return line.slice(name.length + 2);
    }
    if (required) throw new Error(`missing ${name}`);
    return undefined;
  };
  const uri = field("URI", true)!;
  const version = field("Version", true)!;
  const chainIdRaw = field("Chain ID", true)!;
  const nonce = field("Nonce", true)!;
  const issuedAt = field("Issued At", true)!;
  const expirationTime = field("Expiration Time");
  const notBefore = field("Not Before");
  const requestId = field("Request ID");
  const resources: string[] = [];
  if (lines[i] === "Resources:") {
    i++;
    while (lines[i] !== undefined && lines[i].startsWith("- ")) {
      resources.push(lines[i++].slice(2));
    }
  }
  if (i !== lines.length && !(i === lines.length - 1 && lines[i] === "")) {
    throw new Error("unexpected trailing content");
  }
  if (version !== "1") throw new Error("unsupported version");
  if (!/^[0-9]+$/.test(chainIdRaw)) throw new Error("bad chain id");
  if (!/^[a-zA-Z0-9]{8,}$/.test(nonce)) throw new Error("bad nonce");
  for (const ts of [issuedAt, expirationTime, notBefore]) {
    if (ts !== undefined && Number.isNaN(Date.parse(ts))) {
      throw new Error("bad timestamp");
    }
  }
  return {
    scheme,
    domain,
    address: toChecksum(address),
    statement,
    uri,
    version,
    chainId: Number(chainIdRaw),
    nonce,
    issuedAt,
    expirationTime,
    notBefore,
    requestId,
    resources,
  };
}

export interface SiweVerifyInput {
  message: string;
  signature: string;
  domains: string[];
  origins: string[];
  chainId: number;
  now: number; // seconds
  skewSecs: number;
}

/** Verify everything except nonce freshness (the caller owns nonce storage). */
export function verifySiwe(input: SiweVerifyInput): [SiweMessage, null] | [null, string] {
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
  const issued = Date.parse(m.issuedAt) / 1000;
  if (Math.abs(input.now - issued) > input.skewSecs) {
    return [null, "issuedAt out of window"];
  }
  if (
    m.expirationTime !== undefined && input.now >= Date.parse(m.expirationTime) / 1000
  ) {
    return [null, "message expired"];
  }
  if (m.notBefore !== undefined && input.now < Date.parse(m.notBefore) / 1000) {
    return [null, "message not yet valid"];
  }
  const signer = recoverPersonalSign(input.message, input.signature);
  if (!signer || signer.toLowerCase() !== m.address.toLowerCase()) {
    return [null, "signature does not verify"];
  }
  return [m, null];
}

/** Build the canonical EIP-4361 text (used by scripts and tests). */
export function createSiweMessage(f: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  issuedAt: string;
  statement?: string;
  chainId?: number;
  expirationTime?: string;
}): string {
  let out =
    `${f.domain} wants you to sign in with your Ethereum account:\n${f.address}\n\n`;
  if (f.statement) out += `${f.statement}\n`;
  out += `\nURI: ${f.uri}\nVersion: 1\nChain ID: ${
    f.chainId ?? 1
  }\nNonce: ${f.nonce}\nIssued At: ${f.issuedAt}`;
  if (f.expirationTime) out += `\nExpiration Time: ${f.expirationTime}`;
  return out;
}
