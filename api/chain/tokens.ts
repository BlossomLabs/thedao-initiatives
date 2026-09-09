import { TOKENS } from "../config.ts";
import { toChecksum } from "./address.ts";
import { decodeHexInt, decodeString, SEL_DECIMALS, SEL_SYMBOL } from "./abi.ts";
import { ethCall, type Rpc } from "./rpc.ts";

export interface TokenCheck {
  address: string;
  decimals: number;
  ok: boolean;
  detail: string;
}

/** Verify every configured token against the chain itself (decimals + symbol). */
export async function verifyTokens(
  rpc: Rpc,
  tokens: Record<string, [string, number]> = TOKENS,
): Promise<Record<string, TokenCheck>> {
  const out: Record<string, TokenCheck> = {};
  for (const [sym, [addr, decimals]] of Object.entries(tokens)) {
    const entry: TokenCheck = {
      address: toChecksum(addr),
      decimals,
      ok: false,
      detail: "",
    };
    try {
      const chainDec = Number(decodeHexInt(await ethCall(rpc, addr, SEL_DECIMALS)));
      const chainSym = decodeString(await ethCall(rpc, addr, SEL_SYMBOL));
      if (chainDec !== decimals) {
        entry.detail = `decimals mismatch: config=${decimals} chain=${chainDec}`;
      } else if (chainSym.toLowerCase() !== sym.toLowerCase()) {
        entry.detail = `symbol mismatch: config=${sym} chain=${chainSym}`;
      } else {
        entry.ok = true;
        entry.detail = "verified on-chain";
      }
    } catch (e) {
      entry.detail = `verification failed: ${String(e)}`;
    }
    out[sym] = entry;
  }
  return out;
}

/** symbol -> [address, decimals] for tokens that passed verification. */
export function activeTokens(
  state: Record<string, TokenCheck>,
): Record<string, [string, number]> {
  const out: Record<string, [string, number]> = {};
  for (const [sym, t] of Object.entries(state)) {
    if (t.ok) out[sym] = [t.address, t.decimals];
  }
  return out;
}
