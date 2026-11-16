/** The chain states a replay of the round needs (./quiet-ending.ts), read through one
 * small interface so the site's server and a standalone replay script read the chain
 * the same way. A state is the contract's own view at a block: each project's
 * `initiativeUsd(i).askUsd` and `poolUsd()`, read with an eth_call at that block (an
 * archive node serves any block). Nothing here knows about viem, KV or env: browser and
 * Deno. */
import type { VoteManifest } from "./manifest.ts";
import { type ChainState, windowEnds } from "./quiet-ending.ts";

export interface StateSource {
  head(): Promise<{ block: number; timestamp: number }>;
  /** The last block with timestamp < time. */
  blockBefore(time: number): Promise<{ block: number; timestamp: number }>;
  /** At `block` (eth_call with that block): initiativeCount, each initiativeUsd(i).askUsd, poolUsd(). */
  stateAt(
    block: number,
  ): Promise<{ timestamp: number; asks: bigint[]; poolUsd: bigint; withdrawn: boolean[] }>;
  /** Blocks in [from, to] holding a PledgeSet, PoolUsdSet, InitiativeWithdrawn or InitiativeConfigured log from the round's contract. */
  accountingEventBlocks(from: number, to: number): Promise<number[]>;
  /** Blocks in [from, to] where any account's balance in any registered currency changed:
   * ERC-20 Transfer logs to or from an account, and native balances read block by block
   * (a source may keep blocks it has scanned deep enough, and read only the rest again). */
  balanceChangeBlocks(from: number, to: number): Promise<number[]>;
}
/** Optional; only reads of blocks older than the finality margin go in. Values are plain
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
/** The balance cache's finality line moves in steps of this many seconds, so finding it
 * costs one block search per step (cached), not one per call. */
const FINAL_STEP = 300;
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

type Block = { block: number; timestamp: number };
type StoredState = { timestamp: number; asks: string[]; poolUsd: string; withdrawn: boolean[] };
type StoredScan = { from: number; to: number; blocks: number[] };

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
 * Reads of blocks older than `now − finalAfterSecs` go in `cache` and are not made again;
 * newer ones are never cached (a reorg could still change them). A block search by time
 * waits one more margin, for the block after its answer. Balance scans run one chunk at a
 * time. Any read error rejects
 * the whole call: no zeros, and no head values for a past block. A receipt block past
 * the node's head (a lagging archive node) rejects too, and so does a head older than a
 * passed tally start or cutoff (beyond CUTOFF_GRACE_SECS): the blocks between the head
 * and that time are not seen, so the state "before" it would be partial. */
export async function chainStates(
  m: VoteManifest,
  src: StateSource,
  opts: { now: number; receiptBlocks: number[]; cache?: StateCache; finalAfterSecs: number },
): Promise<ChainState[]> {
  const { cache } = opts;
  const s = m.schedule;
  const contract = m.contract.toLowerCase();
  // The clock: what is final, and whether the node lags. The chain: what has happened.
  const wallNow = opts.now;
  const finalBefore = wallNow - opts.finalAfterSecs;
  const head = await src.head();
  const now = judgedAt(wallNow, head.timestamp);
  // Ballots may come from another node: one this node hasn't reached would be judged with
  // an older state. Refuse rather than replay from partial states.
  const ahead = opts.receiptBlocks.filter((b) => b > head.block);
  if (ahead.length) {
    throw new Error(
      `chain states: the node's head ${head.block} is behind a ballot at ${Math.max(...ahead)}`,
    );
  }

  /** The last block before `time`: the head when even it is older. Settled only once the
   * block after it is final too; that one is not read, so a whole finality margin past
   * `time` stands in for it (empty slots never span that long). Searched once per call. */
  const searched = new Map<string, Promise<Block>>();
  const search = (key: string, time: number, keep: boolean): Promise<Block> => {
    let p = searched.get(key);
    if (!p) {
      p = (async () => {
        if (keep && cache) {
          const hit = await cache.get(key);
          if (hit !== undefined) return hit as Block;
        }
        const b = await src.blockBefore(time);
        if (keep && cache) await cache.set(key, { block: b.block, timestamp: b.timestamp });
        return b;
      })();
      searched.set(key, p);
    }
    return p;
  };
  const lastBefore = async (time: number): Promise<Block> =>
    head.timestamp < time
      ? head
      : await search(`before:${contract}:${time}`, time, time + opts.finalAfterSecs <= finalBefore);
  /** A block known final (timestamp < finalBefore), close to the line: the last one
   * before the line rounded down to FINAL_STEP. Any final block is final for good, so
   * this is cached as soon as it is found. */
  const finalLine = async (): Promise<Block> => {
    const time = Math.floor(finalBefore / FINAL_STEP) * FINAL_STEP;
    return head.timestamp < time ? head : await search(`final:${contract}:${time}`, time, true);
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
  /** The last final block, for the balance cache; null when nothing is cached. */
  const finalBlock = scanBalances && cache && scanned.length ? (await finalLine()).block : null;
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
      const finalHi = finalBlock === null ? lo - 1 : Math.min(hi, finalBlock);
      const key = `balances:${m.chainId}:${contract}:accounts2:${m.configRevision ?? "legacy"}:${
        m.configAnchor?.hash ?? ""
      }:${c}`;
      const stored = cache && finalHi >= lo
        ? (await cache.get(key)) as StoredScan | undefined
        : undefined;
      const known = stored && stored.from <= lo ? stored : undefined;
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
  return await mapLimit(order, READS, async (block): Promise<ChainState> => {
    const x = await stateAt(block);
    return { block, ...x, event: events.has(block) };
  });

  async function stateAt(block: number) {
    // `:w1`: states stored before the withdrawn flags existed lack them, and are skipped.
    const key = `state:${contract}:${block}:w1`;
    if (cache) {
      const hit = (await cache.get(key)) as StoredState | undefined;
      if (hit !== undefined) {
        return {
          timestamp: hit.timestamp,
          asks: hit.asks.map(BigInt),
          poolUsd: BigInt(hit.poolUsd),
          withdrawn: hit.withdrawn,
        };
      }
    }
    const x = await src.stateAt(block);
    if (cache && x.timestamp < finalBefore) {
      await cache.set(
        key,
        {
          timestamp: x.timestamp,
          asks: x.asks.map(String),
          poolUsd: String(x.poolUsd),
          withdrawn: x.withdrawn,
        } satisfies StoredState,
      );
    }
    return x;
  }
}
