// Replays TheDAO vote from the chain alone, the same way the site does
// (shared/vote/replay-round.ts): no site database, no KV, no env, no secrets.
//
//   deno task vote:replay --rpc <archive RPC URL>
//     [--site <url>]          (default https://initiatives.thedao.fund: the round it runs)
//     [--manifest <manifest .json>]   (another round, as /api/vote/manifest serves it)
//     [--at <unix seconds>]                              (default: now)
//     [--json]                    ({round, transcript, head}: the replay part of /api/vote/round)
//
// Past blocks need an archive node. Any read failure or a transcript mismatch exits 1.
import { parseArgs } from "jsr:@std/cli@^1.0.32/parse-args";
import { http } from "viem";
import { tierName } from "../shared/vote/ballot.ts";
import { checkManifest, type VoteManifest } from "../shared/vote/manifest.ts";
import {
  errorText,
  FINAL_AFTER_SECS,
  replayRound,
  type Round,
  roundJson,
  type RoundSource,
} from "../shared/vote/replay-round.ts";
import { dayTime } from "../app/lib/format.ts";
import { refreshVoteManifest } from "../api/services/vote-refresh.ts";
import { createRoundSource } from "../api/services/vote-chain.ts";

type Io = {
  /** Tests: the chain to read in place of `--rpc`. */
  source?: RoundSource;
  out?: (line: string) => void;
  err?: (line: string) => void;
};

/** Micro-USD as exact dollars: "$12,345.5", "$0.00015". */
export function dollars(micro: bigint): string {
  const whole = (micro / 1_000_000n).toLocaleString("en-US");
  const frac = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `$${whole}${frac ? `.${frac}` : ""}`;
}

/** The round to replay: a manifest file, or the one the site runs (its public
 * /api/vote/manifest, read from the round's contract). */
async function loadManifest(path?: string, site = "https://initiatives.thedao.fund") {
  let m: unknown;
  if (path) {
    const j = JSON.parse(await Deno.readTextFile(path));
    m = j?.manifest ?? j;
  } else {
    const res = await fetch(`${site.replace(/\/$/, "")}/api/vote/manifest`);
    if (!res.ok) throw new Error(`${site}: /api/vote/manifest answered ${res.status}`);
    m = (await res.json()).manifest;
    if (!m) throw new Error(`${site} runs no vote right now`);
  }
  return checkManifest(m as VoteManifest);
}

/** The round as text: each tier's status, window, funded projects and covered ones. */
export function report(m: VoteManifest, st: Round, now: number): string[] {
  const slug = (c: number) => m.slugs[c];
  const funded = (cs: number[], awards: Map<number, bigint>) =>
    cs.length
      ? cs.map((c) => `${slug(c)} ${awards.has(c) ? dollars(awards.get(c)!) : "?"}`).join(", ")
      : "none";
  const covered = (cs: number[]) => (cs.length ? cs.map(slug).join(", ") : "none");
  const out = [`Round ${m.contract} on chain ${m.chainId}, replayed at ${dayTime(now)}`];
  for (const t of st.tiers) {
    const name = tierName(t.tier);
    if (t.status === "waiting") {
      out.push(`${name}: waiting, first tally ${dayTime(t.startsAt)}`);
      continue;
    }
    if (t.status === "settled") {
      out.push(`${name}: settled ${dayTime(t.at)}${t.forced ? " (last window, forced)" : ""}`);
      out.push(`  funded: ${funded(t.funded, t.awards)}`);
    } else {
      out.push(
        `${name}: settling, window ${t.window} ends ${dayTime(t.windowEndsAt)} (latest end ${
          dayTime(t.latestEndAt)
        }), ${t.quiet ? "quiet so far" : "not quiet"}`,
      );
      out.push(`  funded if it settled now: ${funded(t.funded, st.live.awards)}`);
    }
    out.push(`  covered: ${covered(t.covered)}`);
  }
  out.push(`Ballots: ${st.accepted.size} counted, ${st.rejected.length} refused`);
  out.push(
    `Transcript: matches the contract at block ${st.transcript.block} (${st.transcript.records} records${
      st.transcript.legacy ? ", pre-Nov 14 entries" : ""
    })`,
  );
  out.push(`Head: block ${st.head.block} (${dayTime(st.head.timestamp)})`);
  return out;
}

/** The script; returns its exit code. */
export async function main(argv: string[], io: Io = {}): Promise<number> {
  const out = io.out ?? ((s) => console.log(s));
  const err = io.err ?? ((s) => console.error(s));
  const args = parseArgs(argv, { boolean: ["json"], string: ["rpc", "manifest", "site", "at"] });
  try {
    if (!io.source && !args.rpc) throw new Error("--rpc <archive RPC URL> is required");
    const now = args.at === undefined ? Math.floor(Date.now() / 1000) : Number(args.at);
    if (!Number.isInteger(now) || now <= 0) throw new Error("--at is a time in unix seconds");
    const saved = await loadManifest(args.manifest, args.site);
    const m = io.source ? saved : await refreshVoteManifest(saved, args.rpc!, { at: now });
    const src = io.source ??
      createRoundSource(
        m,
        args.rpc!,
        // Public nodes are slow at times: long timeouts, a few retries.
        http(args.rpc, { timeout: 60_000, retryCount: 4, retryDelay: 1_000 }),
      );
    const st = await replayRound(m, src, { now, finalAfterSecs: FINAL_AFTER_SECS });
    if (args.json) {
      out(JSON.stringify(
        {
          round: roundJson(st, m.slugs),
          transcript: { ...st.transcript, block: st.transcript.block.toString() },
          head: st.head,
        },
        null,
        2,
      ));
    } else {
      for (const line of report(m, st, now)) out(line);
    }
    return 0;
  } catch (e) {
    err(`vote-replay: ${errorText(e)}`);
    return 1;
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
