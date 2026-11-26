/**
 * Incoming transfers to many Safes from the chain's event logs: no indexer.
 *
 * Two `eth_getLogs` filters cover every Safe in one range:
 * - ERC-20 `Transfer` logs of the accepted tokens whose `to` topic is any of
 *   the Safes (topics accept a list of values, so one filter fits them all);
 * - the Safes' own `SafeReceived` logs, emitted by `receive()` for every ETH
 *   they take in, a contract's internal send included (Safe v1.3+).
 * Only tx hashes leave here: amounts are verified per transaction over RPC.
 */
import { addressTopic } from "./address.ts";
import { decodeHexInt } from "./abi.ts";
import type { Rpc } from "./rpc.ts";
import { SAFE_RECEIVED_TOPIC, TRANSFER_TOPIC } from "./verify.ts";

/** Addresses per filter: providers cap topic and address lists. */
export const ADDRESSES_PER_FILTER = 100;

interface RawLog {
  address?: string;
  topics?: string[];
  transactionHash?: string;
  blockNumber?: string;
  removed?: boolean;
}

export interface IncomingTx {
  txHash: string;
  /** The Safe the transfer went to, lowercase. */
  safe: string;
  blockNumber: number;
}

const hex = (n: number) => "0x" + n.toString(16);

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Every tx in [from, to] that sent an accepted token or ETH to one of `safes`,
 * one entry per (tx, Safe). Throws when the provider refuses the range. */
export async function incomingTxs(
  rpc: Rpc,
  safes: string[],
  tokens: string[],
  from: number,
  to: number,
): Promise<IncomingTx[]> {
  const wanted = new Set(safes.map((s) => s.toLowerCase()));
  const range = { fromBlock: hex(from), toBlock: hex(to) };
  const filters: unknown[] = [];
  for (const group of chunks([...wanted], ADDRESSES_PER_FILTER)) {
    filters.push({
      ...range,
      address: tokens,
      topics: [TRANSFER_TOPIC, null, group.map(addressTopic)],
    });
    filters.push({ ...range, address: group, topics: [SAFE_RECEIVED_TOPIC] });
  }
  const results = await Promise.all(
    filters.map((f) => rpc("eth_getLogs", [f]) as Promise<RawLog[] | null>),
  );
  const seen = new Map<string, IncomingTx>();
  for (const logs of results) {
    if (!Array.isArray(logs)) throw new Error("eth_getLogs returned no list");
    for (const log of logs) {
      if (log.removed || !log.transactionHash || !log.topics?.length) continue;
      const topic0 = log.topics[0].toLowerCase();
      const safe = topic0 === TRANSFER_TOPIC
        ? "0x" + (log.topics[2] ?? "").slice(-40).toLowerCase()
        : (log.address ?? "").toLowerCase();
      if (!wanted.has(safe)) continue;
      const txHash = log.transactionHash.toLowerCase();
      const key = `${txHash}:${safe}`;
      if (!seen.has(key)) {
        seen.set(key, { txHash, safe, blockNumber: Number(decodeHexInt(log.blockNumber)) });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.blockNumber - b.blockNumber);
}
