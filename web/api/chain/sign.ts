/** EIP-191 personal_sign recovery via viem. The recovered address is the only
 * thing trusted; callers rebuild/verify the message themselves. */
import { type Hex, hexToBytes, recoverMessageAddress } from "viem";
import { hashMessage } from "viem";

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
