/** Donation math, ported from static/app.js:830-856. Amounts are entered in
 * USD for every token and converted with the server's rates. */

export function toBaseUnits(amountStr: string, decimals: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(amountStr).trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  const whole = BigInt(m[1]);
  const fracPadded = BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  const v = whole * 10n ** BigInt(decimals) + fracPadded;
  return v > 0n ? v : null;
}

export const pad32 = (hex: string): string =>
  hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/** Token quantity string for a USD amount at `rate` USD per token. */
export function tokenQty(usdAmount: number, rate: number, decimals: number): string {
  const prec = Math.min(decimals, 8);
  return (usdAmount / (rate || 1)).toFixed(prec).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function parseUsd(raw: string): number {
  return /^\d+(\.\d+)?$/.test(String(raw).trim()) ? parseFloat(raw) : NaN;
}

/** ERC-20 transfer(address,uint256) calldata. Mirrors api/tests/chain.test.ts. */
export function transferCalldata(to: string, amount: bigint): `0x${string}` {
  return ("0xa9059cbb" + pad32(to) + pad32(amount.toString(16))) as `0x${string}`;
}

export function walletErrorMessage(e: unknown): string {
  const err = e as
    | { code?: number; message?: string; shortMessage?: string; reason?: string }
    | null;
  if (err?.code === 4001) return "you rejected the request in the wallet.";
  if (err?.code === -32002) {
    return "your wallet already has a request open. Open the wallet and finish or dismiss it, then try again.";
  }
  // EIP-1193 4901: the wallet is not on the chain the request needs (Ambire
  // answers personal_sign with it when the site's chain is not enabled there).
  if (err?.code === 4901) {
    return "the wallet is not on Ethereum. Switch it to Ethereum mainnet and try again.";
  }
  const raw = String(err?.shortMessage || err?.message || err?.reason || "");
  if (/not connected to the requested chain/i.test(raw)) {
    return "the wallet is not on Ethereum. Switch it to Ethereum mainnet and try again.";
  }
  if (/insufficient funds/i.test(raw)) {
    return "the wallet does not have enough ETH to pay the network fee.";
  }
  if (/user rejected|denied|rejected the request/i.test(raw)) {
    return "you rejected the request in the wallet.";
  }
  return raw ? raw.slice(0, 200) : "unknown error";
}
