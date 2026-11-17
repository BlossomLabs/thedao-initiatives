// Simulated voters for a Sepolia test vote, all run from here: badges, first ballots and
// revisions through the quiet endings. The voters' keys come from one seed and are never
// stored; their ballots go out in record() batches sent by the relayer, so the voters
// need no ETH.
//
//   VOTE_RELAYER_KEY=0x… SEPOLIA_RPC_URL=https://… VOTE_SIM_SEED=any-phrase \
//     deno task vote-sim [--voters 100] [--revise 40x2,10x3,3x5] [--site https://…]
//                        [--first-id 1000001] [--rpc http://…] [--dry-run]
//
// The round is the one the site runs (its /api/vote/manifest). Each voter mints badge
// first-id + i (if no one holds it yet), sends a first ballot between the opening and the
// S-Tier first tally, and the voters named by --revise change it that many times (40x2:
// 40 voters, twice each), spread from the S-Tier first tally to the close, each time with
// one or two small edits (a project moved a tier, placed or taken off), as people do. A revision
// never moves what a settled tier holds for that voter (the site's /api/vote/round says
// which tiers settled and which ballot counts). Every ballot passes the ballot rules at
// the chain's asks and pool when it's built. Run it again with the same seed to go on:
// it reads each badge's nonce from the chain, and what was already sent stays sent.
//
// Writes vote-sim/<contract>.jsonl (one line per send) and vote-sim/<contract>-voters.csv.

import { parseArgs } from "jsr:@std/cli@1.0.24/parse-args";
import { bytesToHex, type Hex, hexToBytes, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createVoteChain } from "../api/services/vote-chain.ts";
import { decodeBallot, encodeBallot, type Tier, TIERS } from "../shared/vote/ballot.ts";
import { rulesRound, type VoteManifest } from "../shared/vote/manifest.ts";
import { checkBallot, findProof } from "../shared/vote/rules.ts";
import { recordVote } from "../shared/vote/record.ts";
import { voteTypedData } from "../shared/vote/typed-data.ts";
import { lockedLabels } from "../shared/vote/locks.ts";

type Ballot = Partial<Record<string, Tier>>;

/** A small seeded random source (mulberry32): the same seed, the same run. */
export function rng(seed: string) {
  let a = Number.parseInt(keccak256(toBytes(seed)).slice(2, 10), 16) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    shuffle: <T>(xs: T[]) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
export type Rng = ReturnType<typeof rng>;

/** Voter i's key: from the seed, so nothing secret is written down. */
export const voterKey = (seed: string, i: number): Hex =>
  keccak256(toBytes(`vote-sim:${seed}:${i}`));

/** "40x2,10x3,3x5" → how many revisions each voter makes, voter by voter (the rest: 0). */
export function revisionsPlan(spec: string, voters: number): number[] {
  const out = Array<number>(voters).fill(0);
  let i = 0;
  for (const part of spec.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)x(\d+)$/.exec(part);
    if (!m) throw new Error(`--revise: "${part}" isn't <voters>x<times>`);
    for (let k = 0; k < Number(m[1]); k++, i++) {
      if (i >= voters) throw new Error(`--revise names more than the ${voters} voters`);
      out[i] = Number(m[2]);
    }
  }
  return out;
}

export type SimEvent = { at: number; voter: number; kind: "first" | "revise" };

/** Each tier's quiet-ending windows, in order: [start, end) from its first tally, each
 * half the one before (320, 160, 80, 40 s). A window is only reached when the one before
 * changed what the tier funds; until then its moments are still worth a ballot. */
export function windows(s: VoteManifest["schedule"]) {
  const out: { tier: Tier; window: number; start: number; end: number }[] = [];
  s.firstTallyAt.forEach((at, t) => {
    let start = at;
    for (let k = 0; k < s.maxWindows; k++) {
      const end = start + (s.initialWindow >> k);
      out.push({ tier: TIERS[t], window: k + 1, start, end });
      start = end;
    }
  });
  return out;
}

/** `n` moments spread evenly over [from, to), each nudged a little at random. */
const paced = (n: number, from: number, to: number, r: Rng) => {
  const step = (to - from) / Math.max(n, 1);
  return Array.from({ length: n }, (_, j) => Math.floor(from + step * (j + 0.2 + 0.6 * r.next())));
};

/**
 * When each voter sends, slowly: the first ballots evenly from `firstFrom` to a minute
 * before the S-Tier first tally, in a random voter order; then the revisions inside the
 * quiet-ending windows of every tier, each window getting its share by length (so the
 * short last windows see a few too), the last 5 s of each left out. Sorted by time.
 */
export function timeline(
  m: Pick<VoteManifest, "schedule" | "closesAt">,
  revisions: number[],
  r: Rng,
  firstFrom: number,
): SimEvent[] {
  const s = m.schedule;
  const firstTo = Math.max(firstFrom + 1, s.firstTallyAt[0] - 60);
  const events: SimEvent[] = [];
  const order = r.shuffle(revisions.map((_, voter) => voter));
  paced(order.length, firstFrom, firstTo, r).forEach((at, j) =>
    events.push({ at, voter: order[j], kind: "first" })
  );
  const total = revisions.reduce((a, b) => a + b, 0);
  const ws = windows(s).filter((w) => w.end <= m.closesAt);
  const span = ws.reduce((a, w) => a + (w.end - w.start), 0);
  // Each window's share, by length; the rounding left over goes to the longest ones.
  const shares = ws.map((w) => Math.floor(total * (w.end - w.start) / span));
  for (let k = 0; shares.reduce((a, b) => a + b, 0) < total; k++) shares[k % ws.length]++;
  const moments = ws.flatMap((w, k) => paced(shares[k], w.start, w.end - 5, r));
  // Who sends at each moment: every revision of every voter, shuffled.
  const who = r.shuffle(revisions.flatMap((n, voter) => Array<number>(n).fill(voter)));
  moments.forEach((at, j) => events.push({ at, voter: who[j], kind: "revise" }));
  return events.sort((a, b) => a.at - b.at || a.voter - b.voter);
}

/**
 * A ballot that passes the rules at these asks and pool: the `kept` projects stay where
 * they are (settled tiers), the rest is drawn at random into the open tiers until the
 * ballot asks for enough. `withdrawn` (project indexes, the contract's raw flags) ask $0
 * for the size rule and are never drawn. Null when no draw passes in `tries`.
 */
export function drawBallot(
  m: VoteManifest,
  asks: bigint[],
  poolUsd: bigint,
  r: Rng,
  kept: Ballot = {},
  withdrawn: readonly number[] = [],
  tries = 200,
): Ballot | null {
  const round = rulesRound(m, asks, poolUsd, withdrawn);
  const locked = new Set(Object.values(kept));
  const open = TIERS.filter((t) => !locked.has(t));
  if (!open.length) return null;
  const free = m.slugs.filter((slug, i) => !kept[slug] && !withdrawn.includes(i));
  for (let k = 0; k < tries; k++) {
    const b: Ballot = { ...kept };
    const order = r.shuffle(free);
    // A handful in each open tier, then B-Tier (or the last open one) takes what it
    // needs to reach the size the rules want.
    let at = 0;
    for (const t of open.slice(0, -1)) {
      const n = Math.min(r.int(3, 6), order.length - at);
      for (const slug of order.slice(at, at + n)) b[slug] = t;
      at += n;
    }
    const last = open[open.length - 1];
    const n = Math.min(r.int(2, 5), order.length - at);
    for (const slug of order.slice(at, at + n)) b[slug] = last;
    at += n;
    let res = checkBallot(encodeBallot(m.slugs, b), round);
    for (const slug of order.slice(at)) {
      if (res.ok || !res.errors.some((e) => e.rule === "size")) break;
      b[slug] = last;
      res = checkBallot(encodeBallot(m.slugs, b), round);
    }
    if (res.ok) return b;
  }
  return null;
}

/**
 * A revision as a person makes one: one or two small edits to the ballot that counts
 * (`counted`): an open tier's project moved one tier up or down, a new one placed, or one
 * taken off. The `kept` projects (settled tiers) stay where they are, and the result
 * passes the rules at these asks and pool. Redrawing the whole ballot at random, as the
 * sim first did, moved several initiatives in and out of the tier settling at every
 * revision (#119). Falls back to `drawBallot` when no small edit passes in `tries`.
 */
export function reviseBallot(
  m: VoteManifest,
  asks: bigint[],
  poolUsd: bigint,
  r: Rng,
  counted: Ballot,
  kept: Ballot = {},
  withdrawn: readonly number[] = [],
  tries = 200,
): Ballot | null {
  const round = rulesRound(m, asks, poolUsd, withdrawn);
  const locked = new Set(Object.values(kept));
  const open = TIERS.filter((t) => !locked.has(t));
  if (!open.length) return null;
  const movable = m.slugs.filter((slug, i) => !kept[slug] && !withdrawn.includes(i));
  const base: Ballot = { ...kept };
  for (const slug of movable) {
    if (counted[slug] && open.includes(counted[slug]!)) base[slug] = counted[slug];
  }
  const edit = (b: Ballot) => {
    const slug = movable[r.int(0, movable.length - 1)];
    const at = b[slug] ? open.indexOf(b[slug]!) : -1;
    if (at === -1) b[slug] = open[r.int(0, open.length - 1)];
    else {
      const to = at + (r.next() < 0.5 ? -1 : 1);
      if (to < 0 || to >= open.length) delete b[slug];
      else b[slug] = open[to];
    }
  };
  for (let k = 0; k < tries && movable.length; k++) {
    const b: Ballot = { ...base };
    for (let n = r.int(1, 2); n > 0; n--) edit(b);
    if (sameBallot(b, base)) continue;
    if (checkBallot(encodeBallot(m.slugs, b), round).ok) return b;
  }
  return drawBallot(m, asks, poolUsd, r, kept, withdrawn, tries);
}

const sameBallot = (a: Ballot, b: Ballot) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => a[k] === b[k]);
};

/** What a revision must keep: the projects of the tiers locked for this voter, from the
 * ballot that counts (`counted`, as bytes) and how many tiers settled. */
export function keptFor(m: VoteManifest, counted: Hex | undefined, settled: number): Ballot {
  if (!counted || settled === 0) return {};
  const tiers = decodeBallot(hexToBytes(counted), m.slugs);
  const locked = lockedLabels(tiers, settled);
  return Object.fromEntries(Object.entries(tiers).filter(([, t]) => t && locked.has(t)));
}

type RoundView = {
  head: { timestamp: number };
  closed: boolean;
  poolUsd: string;
  asks?: string[];
  /** The contract's withdrawn flags at the head (slugs); absent from servers before it. */
  withdrawnFlags?: string[];
  accepted: Record<string, Hex>;
  tiers: { tier: Tier; status: string }[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return await res.json() as T;
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["dry-run"],
    string: ["voters", "revise", "site", "first-id", "rpc"],
    default: {
      voters: "100",
      revise: "40x2,10x3,3x5",
      site: "https://initiatives.thedao.fund",
      "first-id": "1000001",
    },
  });
  const seed = Deno.env.get("VOTE_SIM_SEED")?.trim();
  if (!seed) throw new Error("Set VOTE_SIM_SEED: the voters' keys come from it.");
  const key = Deno.env.get("VOTE_RELAYER_KEY")?.trim() as Hex | undefined;
  const keyOk = Boolean(key && /^0x[0-9a-fA-F]{64}$/.test(key));
  // A dry run sends nothing, so it needs no key.
  if (!keyOk && !args["dry-run"]) throw new Error("VOTE_RELAYER_KEY is required");
  const rpc = args.rpc ?? Deno.env.get("SEPOLIA_RPC_URL")?.trim() ?? "";
  if (!rpc && !args["dry-run"]) throw new Error("Set SEPOLIA_RPC_URL (or --rpc).");
  const site = args.site.replace(/\/$/, "");
  const voters = Number(args.voters);
  const firstId = BigInt(args["first-id"]);

  const { manifest: m } = await getJson<{ manifest: VoteManifest | null }>(
    `${site}/api/vote/manifest`,
  );
  if (!m) throw new Error(`${site} runs no vote right now.`);
  if (m.kind !== "test") {
    throw new Error("The site runs the real vote: vote-sim is for test rounds.");
  }
  if (!m.ballotRules) {
    throw new Error("This round is from before the ballot rules: deploy a new one.");
  }
  if (Date.now() / 1000 > m.schedule.firstTallyAt[0] - 120) {
    throw new Error(
      "Too late: first ballots go in before the S-Tier first tally. Deploy a new round (vote-deploy).",
    );
  }
  const chain = createVoteChain(m, rpc, keyOk ? key! : null);
  const r = rng(`${seed}:${m.contract}`);
  const plan = revisionsPlan(args.revise, voters);
  const people = Array.from({ length: voters }, (_, i) => {
    const account = privateKeyToAccount(voterKey(seed, i));
    return { i, account, tokenId: firstId + BigInt(i), nonce: 0n };
  });
  const now = () => Math.floor(Date.now() / 1000);
  const events = timeline(m, plan, r, Math.max(now() + 60, m.opensAt + 5));
  log(
    `${m.contract}: ${voters} voters (badges #${firstId}–#${firstId + BigInt(voters - 1)}), ` +
      `${events.length} ballots; S-Tier first tally ${
        new Date(m.schedule.firstTallyAt[0] * 1000).toISOString()
      }`,
  );
  const out = `vote-sim/${m.contract.toLowerCase()}`;
  await Deno.mkdir("vote-sim", { recursive: true });
  await Deno.writeTextFile(
    `${out}-voters.csv`,
    "voter,address,tokenId,revisions\n" +
      people.map((p) => `${p.i},${p.account.address},${p.tokenId},${plan[p.i]}`).join("\n") + "\n",
  );
  if (args["dry-run"]) {
    const hhmmss = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);
    const marks = windows(m.schedule).map((w) => ({
      at: w.start,
      text: `── ${w.tier}-Tier window ${w.window} (to ${hhmmss(w.end)})`,
    }));
    const lines = [
      ...marks,
      ...events.map((e) => ({ at: e.at, text: `${hhmmss(e.at)}  voter ${e.voter}  ${e.kind}` })),
    ].sort((a, b) => a.at - b.at);
    for (const l of lines) console.log(l.text);
    return;
  }
  const record = (line: unknown) =>
    Deno.writeTextFile(`${out}.jsonl`, JSON.stringify(line) + "\n", { append: true });

  // One transaction at a time from the relayer, each waited for (the site relays with
  // the same key and takes the chain's pending count as its floor).
  const sendWait = async (call: Parameters<typeof chain.send>[0]) => {
    const hash = await chain.send(call, await chain.relayerNonce());
    for (;;) {
      const s = await chain.txStatus(hash);
      if (s === "success") return hash;
      if (s === "reverted") throw new Error(`reverted: ${hash}`);
      await sleep(3000);
    }
  };

  // Badges: each voter's, unless it's already minted. All sent at once with consecutive
  // nonces, then waited for together (one at a time takes ~20 min for 100).
  const missing: typeof people = [];
  for (const p of people) {
    // A badge nobody holds yet reverts (ERC721NonexistentToken): it's free.
    const owner = await chain.ownerOf(p.tokenId).catch((e) => {
      if (/0x7e273289|NonexistentToken/.test(String(e))) return null;
      throw e;
    });
    if (owner && owner.toLowerCase() !== p.account.address.toLowerCase()) {
      throw new Error(`badge #${p.tokenId} belongs to someone else: use another --first-id`);
    }
    if (!owner) missing.push(p);
  }
  if (missing.length) {
    let nonce = await chain.relayerNonce();
    const sent: { p: (typeof people)[number]; hash: Hex }[] = [];
    for (const p of missing) {
      sent.push({
        p,
        hash: await chain.send({ fn: "mint", args: [p.account.address, p.tokenId] }, nonce++),
      });
    }
    log(`sent ${sent.length} mints; waiting for them`);
    for (const { p, hash } of sent) {
      for (;;) {
        const s = await chain.txStatus(hash);
        if (s === "success") break;
        if (s === "reverted") throw new Error(`mint of #${p.tokenId} reverted: ${hash}`);
        await sleep(3000);
      }
      await record({ at: now(), kind: "mint", voter: p.i, tokenId: String(p.tokenId), hash });
    }
    log(`minted #${missing[0].tokenId}–#${missing.at(-1)!.tokenId}`);
  }
  for (const p of people) p.nonce = await chain.nonceOf(p.tokenId);

  let view: { at: number; v: RoundView } | null = null;
  const roundNow = async () => {
    if (!view || Date.now() - view.at > 5_000) {
      view = { at: Date.now(), v: await getJson<RoundView>(`${site}/api/vote/round`) };
    }
    return view.v;
  };

  const queue = [...events];
  while (queue.length) {
    const wait = queue[0].at - now();
    if (wait > 0) await sleep(Math.min(wait, 30) * 1000);
    if (queue[0].at > now()) continue;
    const later = queue.findIndex((e) => e.at > now());
    const due = queue.splice(0, later === -1 ? queue.length : later);
    let v: RoundView;
    try {
      v = await roundNow();
    } catch (e) {
      log(`round unreadable (${e instanceof Error ? e.message : e}); trying again in 10 s`);
      queue.unshift(...due.map((x) => ({ ...x, at: now() + 10 })));
      await sleep(10_000);
      continue;
    }
    if (v.closed) {
      log(`the round has closed; ${due.length + queue.length} ballots not sent`);
      break;
    }
    const settled = v.tiers.filter((t) => t.status === "settled").length;
    const asks = (v.asks ?? []).map(BigInt);
    const pool = BigInt(v.poolUsd);
    const withdrawn = m.slugs.flatMap((slug, i) => v.withdrawnFlags?.includes(slug) ? [i] : []);
    if (asks.length !== m.slugs.length) {
      log("the round has no asks yet; trying again in 10 s");
      queue.unshift(...due.map((x) => ({ ...x, at: now() + 10 })));
      continue;
    }
    const votes = [];
    for (const e of due) {
      const p = people[e.voter];
      const counted = v.accepted[String(p.tokenId)];
      // S-Tier has settled without this badge: registration is closed for it.
      if (!counted && settled > 0) {
        log(`voter ${p.i}: no counted ballot and S-Tier settled; skipped`);
        continue;
      }
      const kept = keptFor(m, counted, settled);
      const b = counted
        ? reviseBallot(
          m,
          asks,
          pool,
          r,
          decodeBallot(hexToBytes(counted), m.slugs),
          kept,
          withdrawn,
        )
        : drawBallot(m, asks, pool, r, kept, withdrawn);
      if (!b) {
        log(`voter ${p.i}: every tier it holds has settled; nothing left to change`);
        continue;
      }
      const ballot = bytesToHex(encodeBallot(m.slugs, b));
      const nonce = p.nonce + 1n;
      const signature = await p.account.signTypedData(
        voteTypedData(m, p.tokenId, p.account.address, nonce, ballot),
      );
      const proof = findProof(hexToBytes(ballot), rulesRound(m, asks, pool, withdrawn)) ?? [];
      votes.push({
        p,
        e,
        ballot,
        nonce,
        v: recordVote({ tokenId: p.tokenId, nonce, ballot, signature, proof }),
      });
    }
    // Several per transaction; a refused batch goes again one by one, so one bad
    // ballot (a pool or ask that moved meanwhile) doesn't hold the rest back.
    for (let k = 0; k < votes.length; k += 20) {
      const batch = votes.slice(k, k + 20);
      const send = async (xs: typeof batch) => {
        const hash = await sendWait({ fn: "record", args: [xs.map((x) => x.v)] });
        for (const x of xs) {
          x.p.nonce = x.nonce;
          await record({
            at: now(),
            kind: x.e.kind,
            voter: x.p.i,
            tokenId: String(x.p.tokenId),
            nonce: String(x.nonce),
            ballot: x.ballot,
            hash,
          });
        }
        log(
          `sent ${xs.map((x) => `${x.e.kind === "first" ? "" : "↻"}${x.p.i}`).join(" ")} (${hash})`,
        );
      };
      try {
        await send(batch);
      } catch (e) {
        if (batch.length === 1) {
          log(
            `voter ${batch[0].p.i}: refused (${e instanceof Error ? e.message.split("\n")[0] : e})`,
          );
          continue;
        }
        for (const x of batch) {
          await send([x]).catch((err) =>
            log(
              `voter ${x.p.i}: refused (${
                err instanceof Error ? err.message.split("\n")[0] : err
              })`,
            )
          );
        }
      }
    }
    view = null;
  }
  log(`done; log in ${out}.jsonl`);
}

if (import.meta.main) await main();
