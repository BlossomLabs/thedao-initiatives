/** EIP-191 personal_sign recovery. The recovered address is the only thing
 * trusted; callers rebuild/verify the message themselves. */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak256, utf8 } from "./keccak.ts";
import { toChecksum } from "./address.ts";
import { concat } from "./abi.ts";
import { decodeHex } from "@std/encoding";

const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

export function personalMessageHash(message: string): Uint8Array {
  const raw = utf8(message);
  return keccak256(concat(utf8("\x19Ethereum Signed Message:\n" + raw.length), raw));
}

/** Checksummed signer of personal_sign(message), or null for anything invalid. */
export function recoverPersonalSign(message: string, signature: string): string | null {
  try {
    const sig = String(signature).toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{130}$/.test(sig)) return null;
    const r = BigInt("0x" + sig.slice(0, 64));
    const s = BigInt("0x" + sig.slice(64, 128));
    let v = parseInt(sig.slice(128, 130), 16);
    if (v === 0 || v === 1) v += 27;
    if (v !== 27 && v !== 28) return null;
    if (!(r >= 1n && r < N && s >= 1n && s < N)) return null;
    if (s > N / 2n) return null; // EIP-2 low-s only
    // noble's "recovered" layout is [recovery, r, s]; wallets emit r || s || v
    const bytes = decodeHex((v - 27).toString(16).padStart(2, "0") + sig.slice(0, 128));
    const pub = secp256k1.Signature.fromBytes(bytes, "recovered")
      .recoverPublicKey(personalMessageHash(message)).toBytes(false);
    return toChecksum(
      "0x" + Array.from(keccak256(pub.slice(1)).slice(-20))
        .map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
  } catch {
    return null;
  }
}
