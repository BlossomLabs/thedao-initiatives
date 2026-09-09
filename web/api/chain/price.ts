import { CHAINLINK_FEEDS } from "../config.ts";
import { asInt256, decodeWords, SEL_LATEST_ROUND_DATA } from "./abi.ts";
import { ethCall, type Rpc, RpcError } from "./rpc.ts";

export const RATE_TTL = 600;
/** Reject a Chainlink answer older than its feed's heartbeat plus a margin. */
export const RATE_MAX_STALENESS = 90_000; // 25h (slow FX feeds)
export const RATE_STALENESS: Record<string, number> = { ETH: 2 * 3600 };

export type UsdRate = (symbol: string) => Promise<number>;

export function createPricer(
  rpc: Rpc,
  now: () => number,
  feeds: Record<string, string> = CHAINLINK_FEEDS,
): UsdRate {
  const cache = new Map<string, [number, number]>();
  return async (symbol) => {
    const feed = feeds[symbol];
    if (!feed) return 1.0; // USD stables
    const hit = cache.get(symbol);
    if (hit && now() - hit[1] < RATE_TTL) return hit[0];
    // latestRoundData() -> (roundId, answer, startedAt, updatedAt, answeredInRound)
    const words = decodeWords(await ethCall(rpc, feed, SEL_LATEST_ROUND_DATA));
    if (words.length < 5) {
      throw new RpcError(`price feed returned malformed data for ${symbol}`);
    }
    const answer = asInt256(words[1]);
    const updatedAt = Number(words[3]);
    if (answer <= 0n) throw new RpcError(`price feed returned nothing for ${symbol}`);
    if (updatedAt <= 0) {
      throw new RpcError(`price feed round for ${symbol} is incomplete`);
    }
    const age = now() - updatedAt;
    if (age > (RATE_STALENESS[symbol] ?? RATE_MAX_STALENESS)) {
      throw new RpcError(`price feed for ${symbol} is stale (${Math.floor(age)} s old)`);
    }
    const rate = Number(answer) / 1e8; // all configured feeds use 8 decimals
    if (!(rate > 0.1 && rate < 1_000_000)) {
      throw new RpcError(`price feed for ${symbol} out of sane range: ${rate}`);
    }
    cache.set(symbol, [rate, now()]);
    return rate;
  };
}
