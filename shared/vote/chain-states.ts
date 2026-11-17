/** The chain states a replay of the round needs (./quiet-ending.ts), read through one
 * small interface so the site's server and a standalone replay script read the chain
 * the same way. A state is the contract's own view at a block: each project's
 * `initiativeUsd(i).askUsd` and `poolUsd()`, read with an eth_call at that block (an
 * archive node serves any block). Nothing here knows about viem, KV or env: browser and
 * Deno. */
import type { VoteManifest } from "./manifest.ts";
import { type ChainState, type ValuationEvidence, windowEnds } from "./quiet-ending.ts";

export type ChainBlock = { block: number; timestamp: number; hash?: `0x${string}` };

export interface StateSource {
  /** Sources without finality evidence never persist historical reads. */
  finalized?(): Promise<ChainBlock>;
  blockAt?(block: number): Promise<ChainBlock>;
  head(): Promise<ChainBlock>;
  /** The head read from the node again, for the replay's last check that it hasn't
   * changed (a source that knows its head without a read; default `head`). */
  confirmHead?(): Promise<ChainBlock>;
  /** The last block with timestamp < time. */
  blockBefore(time: number): Promise<ChainBlock>;
  /** At `block` (eth_call with that block): initiativeCount, each initiativeUsd(i).askUsd, poolUsd(). */
  stateAt(
    block: number,
  ): Promise<
    {
      timestamp: number;
      asks: bigint[];
      poolUsd: bigint;
      withdrawn: boolean[];
      valuation?: ValuationEvidence;
    }
  >;
  /** Blocks in [from, to] holding a PledgeSet, PoolUsdSet, InitiativeWithdrawn or InitiativeConfigured log from the round's contract. */
  /** `stateAt`, read at the block named by its hash and only if it is canonical (the
   * read checks itself, so no read of the block after it). */
  stateAtHash?(block: number, hash: `0x${string}`): ReturnType<StateSource["stateAt"]>;
  accountingEventBlocks(from: number, to: number): Promise<number[]>;
  /** Blocks in [from, to] where any account's balance in any registered currency changed:
   * ERC-20 Transfer logs to or from an account, and native balances read block by block
   * (a source may keep blocks it has scanned deep enough, and read only the rest again). */
  balanceChangeBlocks(from: number, to: number): Promise<number[]>;
}
/** Finality evidence must identify a canonical block hash within this replay's head. */
export async function finalizedBlock(
  src: StateSource,
  head: ChainBlock,
  /** `src.finalized()` already started, alongside other reads (finality only advances,
   * so an earlier read is at most more cautious). */
  started?: Promise<ChainBlock>,
): Promise<ChainBlock | null> {
  if (!src.finalized || !src.blockAt) return null;
  const value = await (started ?? src.finalized());
  const at = value.block > head.block ? head : value;
  const canonical = await src.blockAt(at.block);
  if (!canonical.hash) return null;
  if (at.hash && at.hash !== canonical.hash) {
    throw new Error("finalized block is no longer canonical");
  }
  return canonical;
}

/** Optional; only canonical, finalized reads go in. Values are plain
 * JSON (bigints as decimal strings). */
export interface StateCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

/** Balance scans are cached in chunks of this many blocks (a chunk's record stays small
 * even if every block in it changed a balance). */
const SCAN_CHUNK = 2_000;
/** State reads in flight at once. */
const READS = 8;

/** How long after a cutoff the node's head may still be older than it: a block lands
 * every 12 s and takes a few seconds to arrive. Within this the round is judged at the
 * head's time (the cutoff not passed yet); later, a head older than the cutoff is a
 * lagging node, and the read fails. */
export const CUTOFF_GRACE_SECS = 30;

/** The time a round is judged at: `now`, but never past the newest block. Until the
 * chain has every block before a tally time, a ballot, a donation or a pledge may still
 * land before it. Block times are whole seconds and strictly increase, so a head at `t`
 * means every block before `t + 1` is known: a tally time T is passed once the head is
 * at T − 1 or later. */
export const judgedAt = (now: number, headTimestamp: number): number =>
  Math.min(now, headTimestamp + 1);

type Block = ChainBlock;
type StoredState = {
  timestamp: number;
  asks: string[];
  poolUsd: string;
  withdrawn: boolean[];
  valuation?: ValuationEvidence;
};
type StoredScan = { from: number; to: number; hash: string; blocks: number[] };

/** Runs `f` over `xs`, at most `n` at a time; the first failure rejects the whole call. */
async function mapLimit<T, U>(xs: T[], n: number, f: (x: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await f(xs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, worker));
  return out;
}

/** Merges block ranges that overlap or touch. */
function merge(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Every state `replay()` reads, ascending by block, one per block:
 * 1. the last block before each started tier's first tally and before each passed
 *    window cutoff;
 * 2. inside each started tier's span [first tally, min(now, its last cutoff)): each
 *    receipt block (`event: false` unless it also holds an ask-side event) and each
 *    block with a pledge, a pool change or a balance change (`event: true`);
 * 3. the head: the last block before `now`.
 * `now` is judged at the head's time (`judgedAt`): a tally time the head hasn't reached
 * hasn't passed yet.
 * Persistent reads are keyed by canonical block hash and only written through the
 * node's finalized block. Sources without finality and block hashes are never cached.
 * Balance scans run one chunk at a time. Any read error rejects
 * the whole call: no zeros, and no head values for a past block. A receipt block past
 * the node's head (a lagging archive node) rejects too, and so does a head older than a
 * passed tally start or cutoff (beyond CUTOFF_GRACE_SECS): the blocks between the head
 * and that time are not seen, so the state "before" it would be partial. */
export async function chainStates(
  m: VoteManifest,
  src: StateSource,
  opts: { now: number; receiptBlocks: number[]; cache?: StateCache },
): Promise<ChainState[]> {
  // Cache failures and entries too large for KV never prevent a chain-derived result.
  const cache: StateCache | undefined = opts.cache
    ? {
      get: async (key) => {
        try {
          return await opts.cache!.get(key);
        } catch {
          return undefined;
        }
      },
      set: async (key, value) => {
        try {
          if (new TextEncoder().encode(JSON.stringify(value)).length <= 60_000) {
            await opts.cache!.set(key, value);
          }
        } catch { /* A disposable optimization, never a required write. */ }
      },
    }
    : undefined;
  const s = m.schedule;
  const contract = m.contract.toLowerCase();
  // The clock: what is final, and whether the node lags. The chain: what has happened.
  const wallNow = opts.now;
  const early = src.finalized && src.blockAt ? src.finalized() : undefined;
  early?.catch(() => {}); // Awaited below, unless the head read fails first.
  const head = await src.head();
  const finalized = await finalizedBlock(src, head, early);
  const finalBlock = finalized?.block ?? -1;
  const now = judgedAt(wallNow, head.timestamp);
  const checked = new Map<number, Promise<ChainBlock>>();
  const canonical = (block: number): Promise<ChainBlock> => {
    let read = checked.get(block);
    if (!read) {
      read = src.blockAt ? src.blockAt(block) : Promise.resolve({ block, timestamp: 0 });
      checked.set(block, read);
    }
    return read;
  };
  // Ballots may come from another node: one this node hasn't reached would be judged with
  // an older state. Refuse rather than replay from partial states.
  const ahead = opts.receiptBlocks.filter((b) => b > head.block);
  if (ahead.length) {
    throw new Error(
      `chain states: the node's head ${head.block} is behind a ballot at ${Math.max(...ahead)}`,
    );
  }

  // Boundary searches are cheap compared with scanning balances. Never trust a cached
  // block number to identify a canonical prefix after a reorganization.
  const searched = new Map<number, Promise<Block>>();
  const lastBefore = (time: number): Promise<Block> => {
    if (head.timestamp < time) return Promise.resolve(head);
    let read = searched.get(time);
    if (!read) searched.set(time, read = src.blockBefore(time));
    return read;
  };

  /** The tally times passed at `time`: each started tier's first tally and its passed
   * cutoffs; and each started tier's span up to `time`. */
  const passed = (time: number) => {
    const points: number[] = [];
    const spans: [number, number][] = [];
    for (let t = 0; t < s.firstTallyAt.length; t++) {
      const start = s.firstTallyAt[t];
      if (time < start) continue;
      const ends = windowEnds(s, t);
      points.push(start, ...ends.filter((e) => e <= time));
      spans.push([start, Math.min(time, ends.at(-1)!)]);
    }
    return { points, spans };
  };
  const { points, spans } = passed(now);
  // A node whose head is still behind a tally time the clock passed a while ago is
  // lagging: the round would look stuck before it. Refuse rather than serve that.
  const missed = passed(wallNow).points.filter((p) =>
    head.timestamp < p && wallNow - p > CUTOFF_GRACE_SECS
  );
  if (missed.length) {
    throw new Error(
      `chain states: the node's head at ${head.timestamp} is behind the tally time ${
        Math.max(...missed)
      }`,
    );
  }
  const [pointBlocks, nowBlock, ranges] = await Promise.all([
    Promise.all(points.map((p) => lastBefore(p))),
    lastBefore(now),
    Promise.all(spans.map(async ([a, b]): Promise<[number, number]> => [
      (await lastBefore(a)).block + 1,
      (await lastBefore(b)).block,
    ])),
  ]);
  const scanned = merge(ranges.filter(([a, b]) => a <= b));
  const inRange = (b: number) => scanned.some(([lo, hi]) => b >= lo && b <= hi);

  const events = new Set<number>();
  const scanBalances = (m.currencies?.length ?? 0) > 1;
  const [accounting, balances] = await Promise.all([
    Promise.all(scanned.map(([from, to]) => src.accountingEventBlocks(from, to))),
    (async () => {
      // One range after another: a scan is already many reads (the source bounds them).
      const out: number[][] = [];
      if (scanBalances) {
        for (const [from, to] of scanned) out.push(await balanceBlocks(from, to));
      }
      return out;
    })(),
  ]);
  for (const blocks of [...accounting, ...balances]) {
    for (const b of blocks) if (inRange(b)) events.add(b);
  }

  /** The balance-change blocks in [from, to], chunk after chunk; a chunk's final part is
   * cached and only the blocks after it are scanned again. */
  async function balanceBlocks(from: number, to: number): Promise<number[]> {
    const out: number[] = [];
    const first = Math.floor(from / SCAN_CHUNK) * SCAN_CHUNK;
    const chunks: number[] = [];
    for (let c = first; c <= to; c += SCAN_CHUNK) chunks.push(c);
    for (const c of chunks) {
      const lo = Math.max(from, c);
      const hi = Math.min(to, c + SCAN_CHUNK - 1);
      const finalHi = Math.min(hi, finalBlock);
      const key = `balances:${m.chainId}:${contract}:accounts3:${m.configRevision ?? "legacy"}:${
        m.configAnchor?.hash ?? ""
      }:${c}`;
      const stored = cache && finalHi >= lo
        ? (await cache.get(key)) as StoredScan | undefined
        : undefined;
      const anchor = stored && stored.to <= finalBlock ? await canonical(stored.to) : null;
      const known = stored && stored.from <= lo && anchor?.hash === stored.hash
        ? stored
        : undefined;
      const scanFrom = known ? Math.max(lo, known.to + 1) : lo;
      const found = scanFrom <= hi ? await src.balanceChangeBlocks(scanFrom, hi) : [];
      for (const b of known?.blocks ?? []) if (b >= lo && b <= hi) out.push(b);
      out.push(...found.filter((b) => b >= scanFrom && b <= hi));
      if (cache && finalHi >= lo && finalHi > (known?.to ?? -1)) {
        await cache.set(
          key,
          {
            from: known?.from ?? lo,
            to: finalHi,
            hash: (await canonical(finalHi)).hash!,
            blocks: [...(known?.blocks ?? []), ...found.filter((b) => b <= finalHi)],
          } satisfies StoredScan,
        );
      }
    }
    return out;
  }

  const wanted = new Set<number>([
    ...pointBlocks.map((b) => b.block),
    ...opts.receiptBlocks.filter(inRange),
    ...events,
    nowBlock.block,
  ]);
  const order = [...wanted].sort((a, b) => a - b);
  const result = await mapLimit(order, READS, async (block): Promise<ChainState> => {
    const x = await stateAt(block);
    return { block, ...x, event: events.has(block) };
  });
  // The last check, read from the node even where the head is otherwise known.
  const after = src.confirmHead ? await src.confirmHead() : await src.head();
  if (head.block !== after.block || ("hash" in head && head.hash !== (after as ChainBlock).hash)) {
    throw new Error("vote head changed during replay");
  }
  return result;

  async function stateAt(block: number) {
    const reference = await canonical(block);
    const key = `state:${contract}:${reference.hash}:v3`;
    const persistent = cache && block <= finalBlock && reference.hash;
    if (persistent) {
      const hit = (await cache.get(key)) as StoredState | undefined;
      if (
        hit && hit.timestamp === reference.timestamp &&
        Array.isArray(hit.asks) && hit.asks.length <= m.slugs.length &&
        hit.asks.every((x) => typeof x === "string" && /^\d{1,78}$/.test(x)) &&
        typeof hit.poolUsd === "string" && /^\d{1,78}$/.test(hit.poolUsd) &&
        Array.isArray(hit.withdrawn) && hit.withdrawn.every((x) => typeof x === "boolean")
      ) {
        return {
          timestamp: hit.timestamp,
          asks: hit.asks.map(BigInt),
          poolUsd: BigInt(hit.poolUsd),
          withdrawn: hit.withdrawn,
          ...(hit.valuation ? { valuation: hit.valuation } : {}),
        };
      }
    }
    let x: Awaited<ReturnType<StateSource["stateAt"]>>;
    if (src.stateAtHash && reference.hash) {
      // Read by the reference's hash: the node refuses it unless that block is canonical.
      x = await src.stateAtHash(block, reference.hash);
      if (x.timestamp !== reference.timestamp) {
        throw new Error("vote block changed during state read");
      }
    } else {
      x = await src.stateAt(block);
      if (src.blockAt && (await src.blockAt(block)).hash !== reference.hash) {
        throw new Error("vote block changed during state read");
      }
    }
    if (persistent) {
      await cache.set(
        key,
        {
          timestamp: x.timestamp,
          asks: x.asks.map(String),
          poolUsd: String(x.poolUsd),
          withdrawn: x.withdrawn,
          ...(x.valuation ? { valuation: x.valuation } : {}),
        } satisfies StoredState,
      );
    }
    return x;
  }
}
