import { bytesToHex, hexToBytes, recoverMessageAddress } from "viem";

/** Paper codes: `<n>.<base64url(65-byte signature)>`. The issuer signs
 * `codeMessage(n)` offline; the site verifies with the issuer's address only, so
 * nothing is stored and codes printed later (any n) work unchanged. */

/** The text every paper code signs. The codes printed for Devcon 8 are reused for
 * test votes, so it keeps that event's name: changing it voids every printed code. */
export const codeMessage = (n: number): string => `TheDAO Devcon 8 badge #${n}`;

const CODE = /^([1-9]\d{0,9})\.([A-Za-z0-9_-]{86,88})$/;

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function formatCode(n: number, signature: `0x${string}`): string {
  return `${n}.${toBase64Url(hexToBytes(signature))}`;
}

export function parseCode(code: string): { n: number; signature: `0x${string}` } | null {
  const m = CODE.exec(code);
  if (!m) return null;
  const n = Number(m[1]);
  const bytes = fromBase64Url(m[2]);
  if (!Number.isSafeInteger(n) || !bytes || bytes.length !== 65) return null;
  // Canonical encoding only, so one number has one URL.
  if (toBase64Url(bytes) !== m[2]) return null;
  return { n, signature: bytesToHex(bytes) };
}

/** The code's number when the issuer signed it, else null. Never throws. */
export async function verifyCode(code: string, issuer: string): Promise<number | null> {
  const parsed = parseCode(code);
  if (!parsed) return null;
  try {
    const signer = await recoverMessageAddress({
      message: codeMessage(parsed.n),
      signature: parsed.signature,
    });
    return signer.toLowerCase() === issuer.toLowerCase() ? parsed.n : null;
  } catch {
    return null;
  }
}
