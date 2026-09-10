/** EIP-191 personal_sign recovery via viem, plus the EIP-1271 fallback for
 * contract accounts (Safes, smart wallets). The recovered address is the only
 * thing trusted; callers rebuild/verify the message themselves. */
import { type Hex, hexToBytes, recoverMessageAddress } from "viem";
import { hashMessage } from "viem";
import { abiWord, concat } from "./abi.ts";
import { bytesToHex, hexToBytes as looseHexToBytes, selector } from "./keccak.ts";
import { ethCall, type Rpc } from "./rpc.ts";

export const personalMessageHash = (message: string): Uint8Array =>
  hexToBytes(hashMessage(message));

/** Checksummed signer of personal_sign(message), or null for anything invalid. */
export async function recoverPersonalSign(
  message: string,
  signature: string,
): Promise<string | null> {
  const sig = String(signature);
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return null;
  try {
    return await recoverMessageAddress({ message, signature: sig as Hex });
  } catch {
    return null;
  }
}

/** `isValidSignature(bytes32,bytes)` selector; a valid signature returns it back. */
export const SEL_IS_VALID_SIGNATURE = selector("isValidSignature(bytes32,bytes)");
/** Longest contract signature accepted (bytes): room for a Safe with many owners. */
export const MAX_CONTRACT_SIGNATURE_BYTES = 2048;

/** Calldata for `isValidSignature(hash, signature)` (ABI: bytes32, then dynamic bytes). */
export function encodeIsValidSignature(hash: Uint8Array, signature: Uint8Array): string {
  const padded = new Uint8Array(Math.ceil(signature.length / 32) * 32);
  padded.set(signature);
  return SEL_IS_VALID_SIGNATURE +
    bytesToHex(concat(hash, abiWord(64), abiWord(signature.length), padded)).slice(2);
}

/**
 * EIP-1271: ask the contract at `account` whether it accepts `signature` for
 * personal_sign(message). One eth_call; anything but the magic value (an EOA
 * answering "0x", a revert, an RPC outage) is a no, so the check fails closed.
 */
export async function isValidContractSignature(
  rpc: Rpc,
  account: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const sig = String(signature);
  if (!/^0x([0-9a-fA-F]{2})+$/.test(sig)) return false;
  if ((sig.length - 2) / 2 > MAX_CONTRACT_SIGNATURE_BYTES) return false;
  try {
    const data = encodeIsValidSignature(personalMessageHash(message), looseHexToBytes(sig));
    const out = String((await ethCall(rpc, account, data)) ?? "");
    return out.toLowerCase().startsWith(SEL_IS_VALID_SIGNATURE.toLowerCase()) &&
      out.length === 66;
  } catch {
    return false;
  }
}
