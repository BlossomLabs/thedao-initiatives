import { MIN_CONFIRMATIONS, MIN_ETH_DONATION, NATIVE_ETH } from "../config.ts";
import { addressTopic, toChecksum } from "./address.ts";
import { decodeHexInt } from "./abi.ts";
import { eventTopic } from "./keccak.ts";
import { getBlockNumber, type Rpc } from "./rpc.ts";
import type { UsdRate } from "./price.ts";

export const TRANSFER_TOPIC = eventTopic("Transfer(address,address,uint256)");

export interface Verification {
  found: boolean;
  pending: boolean;
  ok: boolean;
  tokenSymbol: string;
  tokenAddress: string;
  amountRaw: string;
  amount: number;
  amountUsd: number;
  donor: string;
  detail: string;
}

export interface VerifyOptions {
  minConfirmations?: number;
  nativeEth?: boolean;
  minEth?: number;
  /** Server-side batch context: reuse one head for confirmation checks. */
  getBlockNumber?: () => Promise<number>;
}

interface Log {
  address?: string;
  topics?: string[];
  data?: string;
}

/**
 * Verify an on-chain donation by its transaction hash: a successful ERC-20
 * Transfer of an allowed token into `recipient` (the RFP's Safe), or a plain
 * ETH send. Amount and sender come from the log/tx, never from the client.
 */
export async function verifyDonationTx(
  rpc: Rpc,
  usdRate: UsdRate,
  txHash: string,
  recipient: string,
  allowedTokens: Record<string, [string, number]>,
  opts: VerifyOptions = {},
): Promise<Verification> {
  const minConf = opts.minConfirmations ?? MIN_CONFIRMATIONS;
  const nativeEth = opts.nativeEth ?? NATIVE_ETH;
  const minEth = opts.minEth ?? MIN_ETH_DONATION;
  const r: Verification = {
    found: false,
    pending: false,
    ok: false,
    tokenSymbol: "",
    tokenAddress: "",
    amountRaw: "0",
    amount: 0,
    amountUsd: 0,
    donor: "",
    detail: "",
  };
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    r.detail = "malformed transaction hash";
    return r;
  }
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]) as
    | { status?: string; blockNumber?: string; logs?: Log[] }
    | null;
  if (!receipt) {
    const tx = await rpc("eth_getTransactionByHash", [txHash]);
    if (tx) {
      r.found = true;
      r.pending = true;
      r.detail = "transaction pending, not yet mined";
    } else {
      r.detail = "transaction not found on mainnet";
    }
    return r;
  }
  r.found = true;
  if (receipt.status !== "0x1") {
    r.detail = "transaction reverted";
    return r;
  }
  const mined = Number(decodeHexInt(receipt.blockNumber));
  let depth = 0;
  try {
    const head = await (opts.getBlockNumber?.() ?? getBlockNumber(rpc));
    depth = mined ? head - mined + 1 : 0;
  } catch {
    depth = 0;
  }
  if (mined && depth < minConf) {
    r.pending = true;
    r.detail = `mined, waiting for confirmations (${Math.max(depth, 0)}/${minConf})`;
    return r;
  }

  const byAddr = new Map<string, [string, number]>();
  for (const [sym, [a, dec]] of Object.entries(allowedTokens)) {
    byAddr.set(a.toLowerCase(), [sym, dec]);
  }
  const wantTo = addressTopic(recipient);

  // Sum every matching transfer of a single token to the Safe so a batched /
  // multicall donation is credited in full. A second accepted token in the
  // same tx is noted but not credited.
  let creditedSym: string | null = null;
  let creditedDec = 0;
  let creditedAddr = "";
  let totalRaw = 0n;
  let donor = "";
  let extraTokens = false;
  for (const log of receipt.logs ?? []) {
    const addr = (log.address ?? "").toLowerCase();
    const topics = log.topics ?? [];
    const tok = byAddr.get(addr);
    if (!tok || topics.length < 3) continue;
    if (topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topics[2].toLowerCase() !== wantTo) continue;
    const raw = decodeHexInt(log.data);
    if (raw <= 0n) continue;
    if (creditedSym === null) {
      [creditedSym, creditedDec] = tok;
      creditedAddr = addr;
      donor = toChecksum("0x" + topics[1].slice(-40));
    }
    if (addr === creditedAddr) totalRaw += raw;
    else extraTokens = true;
  }

  if (creditedSym !== null && totalRaw > 0n) {
    const minRaw = 10n ** BigInt(creditedDec); // dust floor: 1 whole token
    if (totalRaw < minRaw) {
      r.detail = `transfer below the minimum donation of 1 ${creditedSym}`;
      return r;
    }
    let rate: number;
    try {
      rate = await usdRate(creditedSym);
    } catch (e) {
      r.pending = true;
      r.detail = `price feed unavailable, will retry: ${String(e)}`;
      return r;
    }
    r.ok = true;
    r.tokenSymbol = creditedSym;
    r.tokenAddress = toChecksum(creditedAddr);
    r.amountRaw = totalRaw.toString();
    r.amount = Number(totalRaw) / 10 ** creditedDec;
    r.amountUsd = Math.round(r.amount * rate * 100) / 100;
    r.donor = donor;
    r.detail = `verified: ${r.amount} ${creditedSym} received` +
      (extraTokens ? " (other tokens in this tx were not credited)" : "");
    return r;
  }

  if (nativeEth) {
    const tx = await rpc("eth_getTransactionByHash", [txHash]) as
      | { to?: string; from?: string; value?: string }
      | null;
    if (tx && (tx.to ?? "").toLowerCase() === recipient.toLowerCase()) {
      const value = decodeHexInt(tx.value);
      const eth = Number(value) / 1e18;
      if (eth > 0 && eth < minEth) {
        r.detail = `ETH amount below the minimum donation of ${minEth} ETH`;
        return r;
      }
      if (eth > 0) {
        let rate: number;
        try {
          rate = await usdRate("ETH");
        } catch (e) {
          r.pending = true;
          r.detail = `price feed unavailable, will retry: ${String(e)}`;
          return r;
        }
        r.ok = true;
        r.tokenSymbol = "ETH";
        r.tokenAddress = "";
        r.amountRaw = value.toString();
        r.amount = eth;
        r.amountUsd = Math.round(eth * rate * 100) / 100;
        r.donor = toChecksum(tx.from ?? "");
        r.detail = `verified: ${eth} ETH received`;
        return r;
      }
    }
  }
  r.detail =
    "no transfer of an accepted token or ETH to this RFP's address found in this transaction";
  return r;
}
