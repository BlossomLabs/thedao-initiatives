// Deploys a SignedBallots round, sets it up and hands the admin roles to sem-the-bee.eth.
// The site reads the round from its contract: set it on Admin → Vote (its address and
// network) once this prints it.
//
// A test vote, on Sepolia, with the board's initiatives that qualify by Admin → Vote's
// settings (raised at least the floor share of the goal, at most the cap left to raise)
// (badges: Admin → Vote, or scripts/vote-sim.ts):
//   VOTE_RELAYER_KEY=0x… SEPOLIA_RPC_URL=https://… \
//     deno task vote-deploy [--minter 0x…] [--test-usd 0x…] [--board https://initiatives.thedao.fund] [--rpc http://127.0.0.1:8545]
// For a longer rehearsal, --until <ISO date with time zone> sets the final cutoff;
// --setup-minutes 10 opens ten minutes after deployment (default: 30).
// The pool is 400 ETH in dollars at Chainlink's live ETH/USD (read on mainnet:
// MAINNET_RPC_URL, else a public node). By default it opens 30 min after the deploy; S-Tier's
// first tally is 30 min later, and the three tiers then take 30 min at most (10 min
// each). Donations are in a test dollar (TestUSD,
// anyone can mint it; deployed here unless --test-usd names one), and the board's open
// pledges are copied in, as the real vote does.
//
// TheDAO's vote, on mainnet, counting the private voting badges; every flag is required
// and every initiative in the slugs file needs its own Safe:
//   VOTE_RELAYER_KEY=0x… MAINNET_RPC_URL=https://… \
//     deno task vote-deploy --real --opens 2026-11-17T17:00:00Z \
//       --s-tally 2026-12-03T21:00:00Z --a-tally 2026-12-07T21:00:00Z --b-tally 2026-12-09T21:00:00Z \
//       --pool-usd 1250000 --slugs round.txt
// The real vote's windows are 24 h, 12 h, 6 h… nine of them (the last 5 min 37 s), so a
// tier settles within 47 h 54 min 22 s of its first tally; each tally must leave the
// tier above that long.
//
// The relayer key deploys and keeps only MINTER_ROLE; it is also the server's
// sending key. Everything here must finish before opensAt (setup freezes then).
// `--independent-tiers 3` holds A-Tier to the independence rules too (default: S-Tier).
//
// Adding projects to a deployed round (outside every quiet-ending span; the admin
// holds the role, so the admin's wallet sends the calls):
//   deno task vote-deploy --contract 0x… [--real] --add slug-a,slug-b [--rpc …] > add.json
//                                                           (Safe Transaction Builder batch)
//   … the admin executes it …
//   deno task vote-deploy --contract 0x… [--real] --added slug-a,slug-b [--rpc …]
//                                (checks them on-chain; then "Read it again" on Admin → Vote)
//
// Bringing the round's affiliations up to the board's (same windows as adding; add new
// projects first, with --add):
//   deno task vote-deploy --contract 0x… [--real] --affiliations [--rpc …] > groups.json
//   … the admin executes it …
//   deno task vote-deploy --contract 0x… [--real] --affiliated [--rpc …]
//                                (checks them on-chain; then "Read it again" on Admin → Vote)
import { parseArgs } from "jsr:@std/cli@1.0.24/parse-args";
import {
  type Abi,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  type Hex,
  http,
  isAddress,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import {
  CHAINLINK_FEEDS,
  DEFAULT_ADMIN_ADDRESSES,
  DEFAULT_RPC_ENDPOINTS,
  REVIEW_BADGE_CONTRACT,
} from "../api/config.ts";
import { type VoteSettings, voteState } from "../shared/vote.ts";
import { SIGNED_BALLOTS_ABI } from "../shared/vote/abi.ts";
import { adminBatch } from "../shared/vote/admin-batch.ts";
import { checkManifest, type VoteManifest } from "../shared/vote/manifest.ts";
import { readRoundOnChain } from "../api/services/vote-round-read.ts";
import {
  manifestFromChain,
  slugsByAccount,
  testPlaceholder,
  tierSpan,
} from "../shared/vote/round-from-chain.ts";
import { pledgeChainId } from "../shared/vote/typed-data.ts";
import mainnetConfig from "../vote/config/mainnet.json" with { type: "json" };

export const ADMIN = "0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF"; // sem-the-bee.eth
/** A test round's pool: 400 ETH, in dollars at the live ETH/USD price when it is deployed (#97). */
export const TEST_POOL_ETH = 400;
/** Chainlink's ETH/USD feed updates at least hourly; older than this, the deploy stops. */
const FEED_MAX_AGE = 2 * 3600;
const FEED_ABI = [{
  type: "function",
  name: "latestRoundData",
  stateMutability: "view",
  inputs: [],
  outputs: [
    { name: "roundId", type: "uint80" },
    { name: "answer", type: "int256" },
    { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" },
    { name: "answeredInRound", type: "uint80" },
  ],
}] as const;

/** `eth` ETH in dollars (six decimals) at a Chainlink ETH/USD answer (eight decimals),
 * refusing a stale, empty or absurd price. */
export function poolUsdFromFeed(
  eth: number,
  answer: bigint,
  updatedAt: number,
  now: number,
): bigint {
  if (answer <= 0n) throw new Error("the feed gave no ETH price");
  if (now - updatedAt > FEED_MAX_AGE) {
    throw new Error(`the ETH price is stale (${Math.floor((now - updatedAt) / 60)} min old)`);
  }
  if (answer < 100n * 10n ** 8n || answer > 100_000n * 10n ** 8n) {
    throw new Error(`the ETH price is out of range: $${Number(answer) / 1e8}`);
  }
  return (BigInt(Math.round(eth * 1e6)) * answer) / 10n ** 8n;
}

/** How far a pool set by hand is from the live estimate, as a share of the estimate. */
export const poolDrift = (set: bigint, live: bigint): number =>
  Math.abs(Number(set - live)) / Number(live);

/** The pool's dollars now: `eth` at Chainlink's ETH/USD on mainnet (MAINNET_RPC_URL, else
 * a public node), whatever chain the round is on. */
export async function livePoolUsd(eth: number): Promise<{ usd: bigint; price: number }> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(Deno.env.get("MAINNET_RPC_URL") || DEFAULT_RPC_ENDPOINTS[0], {
      timeout: 30_000,
      retryCount: 3,
    }),
  });
  const [, answer, , updatedAt] = await client.readContract({
    address: CHAINLINK_FEEDS.ETH as `0x${string}`,
    abi: FEED_ABI,
    functionName: "latestRoundData",
  });
  const usd = poolUsdFromFeed(eth, answer, Number(updatedAt), Math.floor(Date.now() / 1000));
  return { usd, price: Number(answer) / 1e8 };
}
const SETUP_MINUTES = 30;
// A test vote: S's first tally 30 min after opening, then windows of 5 min 20 s,
// 2 min 40 s, 1 min 20 s and 40 s at most (10 min); A and B each start when the tier
// above can no longer still be running, so the three tiers take 30 min at most.
const VOTING_MINUTES = 30;
export const TEST_WINDOWS = { initialWindow: 320, maxWindows: 4 };
// The real vote: 24 h, 12 h, 6 h, 3 h, 1 h 30 min, 45 min, 22 min 30 s, 11 min 15 s and
// 5 min 37 s: 9 windows, 47 h 54 min 22 s at most.
export const REAL_WINDOWS = { initialWindow: 24 * 60 * 60, maxWindows: 9 };

/** The longest a tier can run: every window, as the contract adds them up. */
export const tierMax = tierSpan;

export type BoardCard = {
  slug: string;
  goalUsd: number;
  safeAddress: string;
  type?: "rfp" | "grant";
  /** The board's raised total (pledges and donations): what qualifies it for the vote. */
  raisedUsd?: number;
  /** From /api/initiatives/affiliations (the board doesn't carry them). */
  affiliations?: string[];
  /** From /api/initiatives/:slug (the board doesn't carry them): the pledge records. */
  pledges?: { id: string; amountUsd: number; status: "pledged" | "received" | "withdrawn" }[];
};
export type Currency = { symbol: string; asset: `0x${string}`; usdFeed: `0x${string}` };
const ZERO = "0x0000000000000000000000000000000000000000" as const;
/** The contract's currency 0: the virtual USD unit its constructor registers. */
export const USD_CURRENCY: Currency = { symbol: "USD", asset: ZERO, usdFeed: ZERO };
/** The real vote's donation currencies, from vote/config/mainnet.json, in id order after 0. */
export const MAINNET_CURRENCIES = mainnetConfig.currencies as Currency[];
/** A test round's one donation currency: its TestUSD token, valued at $1 (no feed). */
export const testCurrencies = (testUsd: `0x${string}`): Currency[] => [
  { symbol: "tUSD", asset: getAddress(testUsd), usdFeed: ZERO },
];
export type PlannedInitiative = {
  slug: string;
  account: `0x${string}`;
  goalUsd: bigint;
  rfp: boolean;
  /** Indexes into the round's group names (one group per affiliation). */
  groups: number[];
};

/** The round's groups: one per affiliation (compared ignoring case, first spelling kept),
 * after the `existing` ones in their order, then in board order. A group name is a
 * bytes32 on-chain. */
export function planGroups(
  cards: BoardCard[],
  existing: string[] = [],
): { names: string[]; groupsOf: (slug: string) => number[] } {
  const names = [...existing];
  const index = new Map(names.map((n, i) => [n.toLowerCase(), i]));
  const bySlug = new Map<string, number[]>();
  for (const c of cards) {
    const ids: number[] = [];
    for (const a of c.affiliations ?? []) {
      if (new TextEncoder().encode(a).length > 32) {
        throw new Error(`${c.slug}: affiliation "${a}" is over 32 bytes`);
      }
      let i = index.get(a.toLowerCase());
      if (i === undefined) {
        i = names.push(a) - 1;
        index.set(a.toLowerCase(), i);
      }
      if (!ids.includes(i)) ids.push(i);
    }
    bySlug.set(c.slug, ids);
  }
  return { names, groupsOf: (slug) => bySlug.get(slug) ?? [] };
}

export const groupMask = (groups: number[]): bigint =>
  groups.reduce((m, g) => m | (1n << BigInt(g)), 0n);

/** Projects may join before opening, or later outside every tier's quiet-ending span
 * [first tally, latest end), never at or after the last end (as the contract checks). */
export function addingOpen(s: Schedule, now: number): boolean {
  const span = tierMax(s);
  if (now < s.opensAt) return true;
  if (now >= s.firstTallyAt[2] + span) return false;
  return s.firstTallyAt.every((t) => now < t || now >= t + span);
}

/** When adding opens again: the end of the span `now` is in; null once the round is over. */
export function nextAddingOpen(s: Schedule, now: number): number | null {
  const span = tierMax(s);
  let t = now;
  // Spans can follow each other with no gap (A starts as S's latest end passes).
  while (!addingOpen(s, t)) {
    if (t >= s.firstTallyAt[2] + span) return null;
    t = s.firstTallyAt.find((x) => t >= x && t < x + span)! + span;
  }
  return t;
}

// Admin → Vote matches a test round's initiatives to the board by these accounts.
const placeholder = testPlaceholder;

/** A test round's initiatives: the board's that qualify by Admin → Vote's settings
 * (#99), in board order. `show` only hides the board's mark, so it doesn't matter here. */
export const qualifyingCards = (cards: BoardCard[], s: VoteSettings): BoardCard[] =>
  cards.filter((c) =>
    c.goalUsd > 0 && voteState(c.raisedUsd ?? 0, c.goalUsd, s).kind === "eligible"
  );

/** Refuses a test round where an initiative would ask for more than the cap. The tally
 * has no cap of its own: an ask is the goal less what the round holds, and a test round
 * holds only the open pledges (not donations already received), so one that qualifies
 * through its donations can still ask for more. */
export function checkAsks(cards: BoardCard[], s: VoteSettings): void {
  const over = cards.map((c) => {
    const pledged = (c.pledges ?? []).filter((p) => p.status === "pledged")
      .reduce((a, p) => a + p.amountUsd, 0);
    return { slug: c.slug, ask: Math.max(0, Math.round(c.goalUsd - pledged)) };
  }).filter((x) => x.ask > s.capUsd);
  if (over.length) {
    const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
    throw new Error(
      `over the ${usd(s.capUsd)} cap once only open pledges count: ` +
        over.map((x) => `${x.slug} asks ${usd(x.ask)}`).join(", "),
    );
  }
}

/** On-chain initiatives in the given order: the Safe when set and unused, else (test
 * votes only) a deterministic placeholder, since the contract needs unique accounts.
 * The real vote pays out to these accounts, so a missing or shared Safe stops it. */
export function planInitiatives(
  cards: BoardCard[],
  { real = false, groups = planGroups(cards) }: {
    real?: boolean;
    groups?: ReturnType<typeof planGroups>;
  } = {},
): PlannedInitiative[] {
  const seen = new Set<string>();
  for (const c of cards) {
    if (c.type === "rfp" && c.affiliations?.length) {
      throw new Error(`${c.slug}: an RFP can't have affiliations`);
    }
  }
  return cards.map((c) => {
    const safe = c.safeAddress && isAddress(c.safeAddress) ? getAddress(c.safeAddress) : null;
    if (real && !safe) throw new Error(`missing Safe: ${c.slug}`);
    if (real && seen.has(safe!.toLowerCase())) throw new Error(`Safe used twice: ${c.slug}`);
    const account = safe && !seen.has(safe.toLowerCase()) ? safe : placeholder(c.slug);
    seen.add(account.toLowerCase());
    return {
      slug: c.slug,
      account,
      goalUsd: BigInt(Math.round(c.goalUsd * 1e6)),
      rfp: c.type === "rfp",
      groups: groups.groupsOf(c.slug),
    };
  });
}

/** EIP-170: the most deployed code a contract may have. */
export const CODE_SIZE_LIMIT = 24_576;

/** Refuses a contract whose deployed code is over EIP-170's limit before it is sent: its
 * deploy would only revert. vote/test/Size.t.sol checks the same, but forge isn't in CI. */
export function checkCodeSize(name: string, deployedBytecode: Hex): void {
  const size = (deployedBytecode.length - 2) / 2;
  if (size > CODE_SIZE_LIMIT) {
    throw new Error(
      `${name} deploys ${size} bytes of code, over the ${CODE_SIZE_LIMIT}-byte limit: rebuild it (forge build) via IR`,
    );
  }
}

/** The roles the round must end the setup with: [role, account, held]. The site's admin
 * holds the three handed-over roles and the relayer none of them; with the real vote each
 * site admin can sign pledges, and a test vote's relayer mints its badges, as does each
 * of `minters` (the site's relayer, when it isn't the account deploying). */
export function roleChecks(o: {
  real: boolean;
  /** DEFAULT_ADMIN_ROLE, ADMIN_ROLE, PLEDGE_ROLE. */
  handed: Hex[];
  minter: Hex;
  admin: Hex;
  relayer: Hex;
  admins: string[];
  minters?: Hex[];
}): [Hex, Hex, boolean][] {
  return [
    ...o.handed.map((r): [Hex, Hex, boolean] => [r, o.admin, true]),
    ...o.handed.map((r): [Hex, Hex, boolean] => [r, o.relayer, false]),
    ...(o.real ? o.admins.map((a): [Hex, Hex, boolean] => [o.handed[2], a as Hex, true]) : []),
    ...(o.real ? [] : [[o.minter, o.relayer, true] as [Hex, Hex, boolean]]),
    ...(o.real ? [] : (o.minters ?? []).map((a): [Hex, Hex, boolean] => [o.minter, a, true])),
  ];
}

/** --minter: the extra accounts that mint a test round's badges (comma-separated), e.g. the
 * site's relayer (Admin → Vote shows it) when another key deploys. Not for the real vote. */
export function parseMinters(value: string | undefined, real: boolean, deployer: Hex): Hex[] {
  if (!value) return [];
  if (real) throw new Error("--minter is for test votes: the real vote mints no badges");
  const out = value.split(",").map((a) => a.trim()).filter(Boolean).map((a) => {
    if (!isAddress(a)) throw new Error(`--minter: ${a} isn't an address`);
    return getAddress(a);
  });
  return [...new Set(out)].filter((a) => a.toLowerCase() !== deployer.toLowerCase());
}

/** What differs between the currencies the round registered (`currency(i)`, read back)
 * and the ones it should have, in order; null when they match. */
export function currencyMismatch(
  want: Currency[],
  got: { asset: string; usdFeed: string }[],
): string | null {
  if (got.length !== want.length) return `${got.length} currencies, expected ${want.length}`;
  for (const [i, w] of want.entries()) {
    const g = got[i];
    if (g.asset.toLowerCase() !== w.asset.toLowerCase()) {
      return `currency ${i} (${w.symbol}) has asset ${g.asset}, expected ${w.asset}`;
    }
    if (g.usdFeed.toLowerCase() !== w.usdFeed.toLowerCase()) {
      return `currency ${i} (${w.symbol}) has feed ${g.usdFeed}, expected ${w.usdFeed}`;
    }
  }
  return null;
}

/** The calls between the setup and the hand-over: the currencies in order (they freeze
 * at opening), PLEDGE_ROLE for each site admin so they can sign pledges (the real vote
 * only: a test round's pledges stay the site's after the deploy), then each open board
 * pledge as a currency-0 (virtual USD) pledge on its project. `cards` are in the same
 * order as `plan`. */
export function planDonationSetup(o: {
  real: boolean;
  currencies: Currency[];
  admins: string[];
  pledgeRole: Hex;
  cards: BoardCard[];
  plan: PlannedInitiative[];
}): { fn: "registerCurrency" | "grantRole" | "setPledge"; args: readonly unknown[] }[] {
  const admins = o.real
    ? [...new Map(o.admins.map((a) => [a.toLowerCase(), getAddress(a)])).values()]
    : [];
  return [
    ...o.currencies.map((c) => ({
      fn: "registerCurrency" as const,
      args: [c.asset, c.usdFeed] as const,
    })),
    ...admins.map((a) => ({ fn: "grantRole" as const, args: [o.pledgeRole, a] as const })),
    ...o.cards.flatMap((c, i) =>
      (c.pledges ?? []).filter((p) => p.status === "pledged").map((p) => ({
        fn: "setPledge" as const,
        args: [pledgeChainId(p.id), BigInt(i), 0n, BigInt(Math.round(p.amountUsd * 1e6))] as const,
      }))
    ),
  ];
}

export type TestTiming = { until?: number; setupMinutes?: number };

/** Explicit test timing is checked before any deployment transaction. */
export function parseTestTiming(a: {
  real?: boolean;
  until?: string;
  "setup-minutes"?: string;
}): TestTiming {
  if (a.real && (a.until !== undefined || a["setup-minutes"] !== undefined)) {
    throw new Error("--until and --setup-minutes are only for test votes");
  }
  const timing: TestTiming = {};
  if (a.until !== undefined) {
    const value = a.until.trim();
    const t = Date.parse(value);
    if (!/T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(t)) {
      throw new Error("--until must be an ISO date with an explicit time zone");
    }
    timing.until = Math.floor(t / 1000);
  }
  if (a["setup-minutes"] !== undefined) {
    const n = Number(a["setup-minutes"]);
    if (!Number.isSafeInteger(n) || n < 5) {
      throw new Error("--setup-minutes must be a whole number of at least 5");
    }
    timing.setupMinutes = n;
  }
  return timing;
}

export function voteSchedule(now: number, timing: TestTiming = {}) {
  const opensAt = now + (timing.setupMinutes ?? SETUP_MINUTES) * 60;
  const span = tierMax(TEST_WINDOWS);
  const s = timing.until === undefined ? opensAt + VOTING_MINUTES * 60 : timing.until - 3 * span;
  if (s <= opensAt) {
    throw new Error(
      "--until must leave voting time after setup and 30 minutes for the three tiers",
    );
  }
  return {
    opensAt,
    ...TEST_WINDOWS,
    firstTallyAt: [s, s + span, s + 2 * span] as [number, number, number],
  };
}

export type Schedule = ReturnType<typeof voteSchedule>;

/** The real vote: each tier's first tally where the team sets it. Each must leave the
 * tier above its longest run, as the contract checks (it would revert otherwise). */
export function realSchedule(opensAt: number, tallies: [number, number, number]): Schedule {
  const s = { opensAt, ...REAL_WINDOWS, firstTallyAt: tallies };
  const span = tierMax(s);
  const names = ["--s-tally", "--a-tally", "--b-tally"];
  if (tallies[0] < opensAt) throw new Error("--s-tally must come after --opens");
  for (const t of [1, 2]) {
    if (tallies[t] < tallies[t - 1] + span) {
      throw new Error(
        `${names[t]} must be at least ${span} s (47 h 54 min 22 s) after ${names[t - 1]}`,
      );
    }
  }
  return s;
}

export type RealArgs = {
  opensAt: number;
  tallies: [number, number, number];
  poolUsd: bigint;
  slugsFile: string;
};

/** `--real` takes no defaults: the opening, each tier's first tally (ISO dates), the
 * pool in whole dollars and a file of initiative slugs, one per line, in ballot order. */
export function parseRealArgs(
  a: {
    opens?: string;
    "s-tally"?: string;
    "a-tally"?: string;
    "b-tally"?: string;
    "pool-usd"?: string;
    slugs?: string;
  },
): RealArgs {
  const need = (flag: keyof typeof a) => {
    const v = a[flag]?.trim();
    if (!v) throw new Error(`--${flag} is required with --real`);
    return v;
  };
  const date = (flag: "opens" | "s-tally" | "a-tally" | "b-tally") => {
    const t = Date.parse(need(flag));
    if (!Number.isFinite(t)) throw new Error(`--${flag} is not a date`);
    return Math.floor(t / 1000);
  };
  const opensAt = date("opens");
  const tallies: [number, number, number] = [date("s-tally"), date("a-tally"), date("b-tally")];
  if (tallies[0] <= opensAt) throw new Error("--s-tally must come after --opens");
  realSchedule(opensAt, tallies); // the gaps between tiers, checked before anything is sent
  const dollars = need("pool-usd").replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(dollars)) throw new Error("--pool-usd must be whole dollars");
  return { opensAt, tallies, poolUsd: BigInt(dollars) * 1_000_000n, slugsFile: need("slugs") };
}

/** A round's manifest as the site reads it from the contract (tests build fixtures with it). */
export function manifestFor(
  r: {
    kind: "test" | "real";
    contract: `0x${string}`;
    deployBlock: number;
    schedule: Schedule;
    poolUsd: bigint;
    slugs: string[];
    projects: VoteManifest["projects"];
    groups: string[];
    independentTiers: number;
    currencies?: Currency[];
    accounts?: `0x${string}`[];
  },
): VoteManifest {
  return {
    kind: r.kind,
    chainId: r.kind === "real" ? mainnet.id : sepolia.id,
    contract: r.contract,
    deployBlock: r.deployBlock,
    opensAt: r.schedule.opensAt,
    // The latest the round can end: B's last window. The quiet ending settles earlier.
    closesAt: r.schedule.firstTallyAt[2] + tierMax(r.schedule),
    schedule: r.schedule,
    poolUsd: r.poolUsd.toString(),
    ...(r.kind === "real" ? { badge: REVIEW_BADGE_CONTRACT } : {}),
    slugs: r.slugs,
    projects: r.projects,
    groups: r.groups,
    ...(r.currencies ? { currencies: r.currencies } : {}),
    ...(r.accounts ? { accounts: r.accounts } : {}),
    independentTiers: r.independentTiers,
    ballotRules: true,
  };
}

/** Adding projects to a deployed round: the admin's calls (new groups, then each
 * project) and the manifest with them appended (indexes never move). */
export function addPlan(
  m: VoteManifest,
  cards: BoardCard[],
): {
  calls: { fn: "addGroup" | "addInitiative"; args: readonly unknown[] }[];
  manifest: VoteManifest;
} {
  for (const c of cards) {
    if (m.slugs.includes(c.slug)) throw new Error(`${c.slug} is already in the round`);
  }
  const groups = planGroups(cards, m.groups);
  const plan = planInitiatives(cards, { real: m.kind === "real", groups });
  const calls = [
    ...groups.names.slice(m.groups.length).map((n) => ({
      fn: "addGroup" as const,
      args: [stringToHex(n, { size: 32 })] as const,
    })),
    ...plan.map((p) => ({
      fn: "addInitiative" as const,
      args: [p.account, p.goalUsd, p.rfp, groupMask(p.groups)] as const,
    })),
  ];
  return {
    calls,
    manifest: {
      ...m,
      slugs: [...m.slugs, ...plan.map((p) => p.slug)],
      projects: [
        ...m.projects,
        ...plan.map((p) => ({ goalUsd: p.goalUsd.toString(), rfp: p.rfp, groups: p.groups })),
      ],
      groups: groups.names,
      ...(m.accounts ? { accounts: [...m.accounts, ...plan.map((p) => p.account)] } : {}),
    },
  };
}

/** Bringing a deployed round's affiliations up to the board's: the admin's calls (new
 * groups, then each project whose groups changed) and the manifest with them. Group
 * names never move or go away (an emptied one stays, unused); a project the board no
 * longer lists keeps its groups. `cards` may hold any board initiatives: those not in
 * the round are ignored (add them first). */
export function regroupPlan(
  m: VoteManifest,
  cards: BoardCard[],
): {
  calls: { fn: "addGroup" | "setInitiativeGroups"; args: readonly unknown[] }[];
  manifest: VoteManifest;
  changed: string[];
} {
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  const inRound = m.slugs.flatMap((slug) => bySlug.get(slug) ?? []);
  for (const c of inRound) {
    const i = m.slugs.indexOf(c.slug);
    if (m.projects[i].rfp && c.affiliations?.length) {
      throw new Error(`${c.slug}: an RFP can't have affiliations`);
    }
  }
  const groups = planGroups(inRound, m.groups);
  const projects = m.projects.map((p, i) =>
    bySlug.has(m.slugs[i]) ? { ...p, groups: groups.groupsOf(m.slugs[i]) } : p
  );
  const changed = m.slugs.filter((_, i) =>
    groupMask(projects[i].groups) !== groupMask(m.projects[i].groups)
  );
  return {
    calls: [
      ...groups.names.slice(m.groups.length).map((n) => ({
        fn: "addGroup" as const,
        args: [stringToHex(n, { size: 32 })] as const,
      })),
      ...changed.map((slug) => {
        const i = m.slugs.indexOf(slug);
        return {
          fn: "setInitiativeGroups" as const,
          args: [BigInt(i), groupMask(projects[i].groups)] as const,
        };
      }),
    ],
    manifest: { ...m, groups: groups.names, projects },
    changed,
  };
}

/** A deployed round as the site reads it: from its contract, the board matching each
 * initiative by its account (the same as Admin → Vote). */
async function roundAt(
  args: { contract?: string; real?: boolean; rpc?: string; board?: string },
) {
  if (!args.contract || !isAddress(args.contract)) {
    throw new Error("--contract <the round's address> is required");
  }
  const chain = args.real ? mainnet : sepolia;
  const rpc = args.rpc ?? Deno.env.get(args.real ? "MAINNET_RPC_URL" : "SEPOLIA_RPC_URL");
  if (!rpc) throw new Error("--rpc or the chain's RPC env var is required");
  const cards = await boardCards(args.board);
  const read = await readRoundOnChain(
    getAddress(args.contract),
    rpc,
    http(rpc, { timeout: 60_000, retryCount: 6 }),
    chain.id as 1 | 11155111,
  );
  const m = checkManifest(
    manifestFromChain(getAddress(args.contract), read, slugsByAccount(cards)),
  );
  const pub = createPublicClient({
    chain,
    transport: http(rpc, { timeout: 60_000, retryCount: 6 }),
  });
  return { m, pub, cards };
}

/** Refuses when the contract won't take projects or group changes now. */
function requireAddingOpen(m: VoteManifest, now: number) {
  if (addingOpen(m.schedule, now)) return;
  const next = nextAddingOpen(m.schedule, now);
  throw new Error(
    next === null
      ? "Adding is closed until the round ends: a tier is settling, and the next starts as it may still end."
      : `Adding is closed until ${new Date(next * 1000).toISOString()}`,
  );
}

/** The board's initiatives with their affiliations (the board itself doesn't carry them). */
async function boardCards(board = "https://initiatives.thedao.fund"): Promise<BoardCard[]> {
  const base = board.replace(/\/+$/, "");
  const [b, a] = await Promise.all([
    fetch(`${base}/api/board`).then((r) => r.json()) as Promise<{
      cards: { initiative: BoardCard; summary: { total: number } }[];
    }>,
    fetch(`${base}/api/initiatives/affiliations`).then((r) => r.json()) as Promise<{
      affiliations: Record<string, string[]>;
    }>,
  ]);
  return b.cards.map((c) => ({
    ...c.initiative,
    raisedUsd: c.summary.total,
    affiliations: a.affiliations[c.initiative.slug],
  }));
}

/** Admin → Vote's qualify settings, as the board applies them. */
async function boardVoteSettings(base: string): Promise<VoteSettings> {
  const r = await fetch(`${base}/api/board/settings`);
  if (!r.ok) throw new Error(`vote settings unreadable (${r.status})`);
  const { vote } = (await r.json()) as { vote?: VoteSettings };
  if (!vote || !Number.isFinite(vote.floorPct) || !Number.isFinite(vote.capUsd)) {
    throw new Error("vote settings missing from /api/board/settings");
  }
  return vote;
}

/** --add: the admin's calls as a Safe Transaction Builder batch, if adding is open now.
 * --added: after the admin ran them, checks each project is in the round on-chain. */
async function addMain(
  args: {
    add?: string;
    added?: string;
    board?: string;
    rpc?: string;
    contract?: string;
    real?: boolean;
  },
) {
  const { m, pub, cards: board } = await roundAt(args);
  const slugs = (args.add ?? args.added)!.split(",").map((x) => x.trim()).filter(Boolean);
  if (args.added) {
    const missing = slugs.filter((slug) => !m.slugs.includes(slug));
    if (missing.length) throw new Error(`not in the round on-chain yet: ${missing.join(", ")}`);
    console.log(
      `${slugs.join(", ")} in the round on-chain; press "Read it again" on Admin → Vote.`,
    );
    return;
  }
  const bySlug = new Map(board.map((c) => [c.slug, c]));
  const cards = slugs.map((slug) => {
    const c = bySlug.get(slug);
    if (!c) throw new Error(`not on the board: ${slug}`);
    return c;
  });
  const { calls } = addPlan(m, cards);
  requireAddingOpen(m, Number((await pub.getBlock()).timestamp));
  console.log(JSON.stringify(adminBatch(m, `Add ${slugs.join(", ")} to the vote`, calls), null, 2));
}

/** --affiliations: the admin's calls that bring the round's affiliations up to the
 * board's, if adding is open now. --affiliated: after the admin ran them, checks that the
 * round on-chain matches the board. */
async function regroupMain(
  args: {
    affiliations?: boolean;
    affiliated?: boolean;
    board?: string;
    rpc?: string;
    contract?: string;
    real?: boolean;
  },
) {
  const { m, pub, cards } = await roundAt(args);
  const { calls, changed } = regroupPlan(m, cards);
  if (args.affiliated) {
    if (calls.length) {
      throw new Error(`still differs from the board: ${changed.join(", ") || "new groups"}`);
    }
    console.log(
      `The round's affiliations match the board's; press "Read it again" on Admin → Vote.`,
    );
    return;
  }
  if (!calls.length) {
    console.error("The round's affiliations already match the board's.");
    return;
  }
  requireAddingOpen(m, Number((await pub.getBlock()).timestamp));
  console.error(`${changed.length} projects change groups: ${changed.join(", ")}`);
  console.log(JSON.stringify(adminBatch(m, "Update the vote's affiliations", calls), null, 2));
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["real", "affiliations", "affiliated"],
    string: [
      "board",
      "rpc",
      "opens",
      "s-tally",
      "a-tally",
      "b-tally",
      "pool-usd",
      "slugs",
      "independent-tiers",
      "add",
      "added",
      "admins",
      "test-usd",
      "minter",
      "contract",
      "until",
      "setup-minutes",
    ],
  });
  if (args.add || args.added) return await addMain(args);
  if (args.affiliations || args.affiliated) return await regroupMain(args);
  const independentTiers = Number(args["independent-tiers"] ?? 1);
  if (independentTiers !== 1 && independentTiers !== 3) {
    throw new Error("--independent-tiers is 1 (S-Tier) or 3 (S-Tier and A-Tier)");
  }
  const real = args.real ? parseRealArgs(args) : null;
  const testTiming = parseTestTiming(args);
  const chain = real ? mainnet : sepolia;
  // DEVCON_RELAYER_KEY: the name before the rename, still accepted.
  const key = (Deno.env.get("VOTE_RELAYER_KEY") || Deno.env.get("DEVCON_RELAYER_KEY"))?.trim() as
    | Hex
    | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("VOTE_RELAYER_KEY is required");
  if (args["test-usd"] && (real || !isAddress(args["test-usd"]))) {
    throw new Error("--test-usd takes a TestUSD address, and only for a test vote");
  }
  const rpcEnv = real ? "MAINNET_RPC_URL" : "SEPOLIA_RPC_URL";
  const rpc = args.rpc ?? Deno.env.get(rpcEnv);
  if (!rpc) throw new Error(`--rpc or ${rpcEnv} is required`);

  const account = privateKeyToAccount(key);
  const minters = parseMinters(args.minter, Boolean(real), account.address);
  // Public RPCs are slow at times: long timeouts, several retries.
  const transport = http(rpc, { timeout: 60_000, retryCount: 6, retryDelay: 1_000 });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  if ((await pub.getChainId()) !== chain.id) throw new Error(`RPC is not ${chain.name}`);

  let cards = await boardCards(args.board);
  const base = (args.board ?? "https://initiatives.thedao.fund").replace(/\/+$/, "");
  const qualify = real ? null : await boardVoteSettings(base);
  if (qualify) {
    const all = cards.length;
    cards = qualifyingCards(cards, qualify);
    console.log(
      `${cards.length} of ${all} initiatives qualify (raised ${qualify.floorPct}% or more, ` +
        `$${qualify.capUsd.toLocaleString("en-US")} or less left)`,
    );
    if (!cards.length) throw new Error("no initiative qualifies: nothing to vote on");
  }
  if (real) {
    // The real vote's initiatives, in the file's order (ballot byte i = line i).
    const slugs = (await Deno.readTextFile(real.slugsFile)).split("\n").map((l) => l.trim())
      .filter(Boolean);
    const bySlug = new Map(cards.map((c) => [c.slug, c]));
    cards = slugs.map((slug) => {
      const c = bySlug.get(slug);
      if (!c) throw new Error(`not on the board: ${slug}`);
      return c;
    });
  }
  const groups = planGroups(cards);
  const plan = planInitiatives(cards, { real: Boolean(real), groups });
  // The open pledges (the board lists only totals; each page has its records). A test
  // round copies them too, so its asks are the board's.
  for (const c of cards) {
    const r = await fetch(`${base}/api/initiatives/${encodeURIComponent(c.slug)}`);
    if (!r.ok) throw new Error(`${c.slug}: pledges unreadable (${r.status})`);
    c.pledges = ((await r.json()) as { pledges: NonNullable<BoardCard["pledges"]> }).pledges;
  }
  if (qualify) checkAsks(cards, qualify);
  // The site's admins sign pledges: --admins, else ADMIN_ADDRESSES, else the site's default list.
  const admins = (args.admins ?? Deno.env.get("ADMIN_ADDRESSES") ?? "").split(",").map((x) =>
    x.trim()
  ).filter(Boolean);
  if (!admins.length) admins.push(...DEFAULT_ADMIN_ADDRESSES);
  for (const a of admins) if (!isAddress(a)) throw new Error(`admin is not an address: ${a}`);
  const usd = (n: bigint) =>
    `$${(Number(n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  let poolUsd: bigint;
  if (real) {
    // Set by hand (--pool-usd); the live estimate is only a check against a stale figure.
    poolUsd = real.poolUsd;
    const live = await livePoolUsd(TEST_POOL_ETH).catch(() => null);
    if (!live) console.warn("Couldn't read the ETH price to check --pool-usd against it.");
    else if (poolDrift(poolUsd, live.usd) > 0.05) {
      console.warn(
        `WARNING: --pool-usd ${usd(poolUsd)} is ${
          Math.round(poolDrift(poolUsd, live.usd) * 100)
        }% ` +
          `off ${TEST_POOL_ETH} ETH at $${live.price.toFixed(2)} (${usd(live.usd)}).`,
      );
    }
  } else {
    const live = await livePoolUsd(TEST_POOL_ETH);
    poolUsd = live.usd;
    console.log(`Pool: ${TEST_POOL_ETH} ETH at $${live.price.toFixed(2)} = ${usd(poolUsd)}`);
  }
  const openPledges = cards.flatMap((c) => c.pledges ?? []).filter((p) => p.status === "pledged");
  console.log(
    `${plan.length} initiatives, ${groups.names.length} affiliations, ${openPledges.length} open pledges`,
  );

  const artifact = JSON.parse(
    await Deno.readTextFile(
      new URL("../vote/out/SignedBallots.sol/SignedBallots.json", import.meta.url),
    ),
  ) as { bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
  checkCodeSize("SignedBallots", artifact.deployedBytecode.object);
  const block = await pub.getBlock();
  if (!real) voteSchedule(Number(block.timestamp), testTiming);
  if (real && Number(block.timestamp) + SETUP_MINUTES * 60 > real.opensAt) {
    throw new Error(`--opens must leave ${SETUP_MINUTES} minutes for the setup`);
  }
  const wait = async (hash: Hex, what: string) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
    return r;
  };

  // A test round's donations: its own dollar, deployed before the round so it doesn't
  // eat into the setup time (or one deployed earlier, reused).
  let testUsd = args["test-usd"] ? getAddress(args["test-usd"]) : null;
  if (!real && !testUsd) {
    const t = JSON.parse(
      await Deno.readTextFile(new URL("../vote/out/TestUSD.sol/TestUSD.json", import.meta.url)),
    ) as { abi: Abi; bytecode: { object: Hex } };
    testUsd = (await wait(
      await wallet.deployContract({ abi: t.abi, bytecode: t.bytecode.object }),
      "TestUSD deploy",
    )).contractAddress!;
    console.log(`TestUSD ${testUsd}`);
  }
  const currencies = real ? MAINNET_CURRENCIES : testCurrencies(testUsd!);
  // Reserve setup time from the round's deploy, not from when the script started.
  const s = real ? realSchedule(real.opensAt, real.tallies) : voteSchedule(
    Number((await pub.getBlock()).timestamp),
    testTiming,
  );

  const deployHash = await wallet.deployContract({
    abi: SIGNED_BALLOTS_ABI,
    bytecode: artifact.bytecode.object,
    args: [
      account.address,
      // The real vote counts TheDAO's voting badges; a test vote mints its own.
      real ? REVIEW_BADGE_CONTRACT : "0x0000000000000000000000000000000000000000",
      real ? "TheDAO vote" : "TheDAO test vote",
      real ? "VOTE" : "TESTVOTE",
      {
        opensAt: BigInt(s.opensAt),
        initialWindow: BigInt(s.initialWindow),
        firstTallyAt: s.firstTallyAt.map(BigInt) as [bigint, bigint, bigint],
        maxWindows: s.maxWindows,
      },
    ],
  });
  const deployed = await wait(deployHash, "deploy");
  const contract = deployed.contractAddress!;
  console.log(
    `Deployed ${contract} in block ${deployed.blockNumber}; opens at ${
      new Date(s.opensAt * 1000).toISOString()
    }`,
  );

  // The whole setup is one atomic transaction (EIP-7702): the relayer account
  // delegates to BatchExecutor and calls itself, so every step runs with the
  // relayer as msg.sender. All of it lands or none of it does.
  // At the deploy's block, retried: a load-balanced RPC may not have it yet.
  const role = async (name: string): Promise<Hex> => {
    for (let k = 1;; k++) {
      try {
        return await pub.readContract({
          address: contract,
          abi: SIGNED_BALLOTS_ABI,
          functionName: name as never,
          blockNumber: deployed.blockNumber,
        }) as Hex;
      } catch (e) {
        if (k >= 6) throw e;
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };
  const handed = await Promise.all(["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE", "PLEDGE_ROLE"].map(role));
  const minterRole = await role("MINTER_ROLE");
  const step = (functionName: string, fnArgs: readonly unknown[]) => ({
    to: contract,
    value: 0n,
    data: encodeFunctionData({
      abi: SIGNED_BALLOTS_ABI,
      functionName: functionName as never,
      args: fnArgs as never,
    }),
  });
  const donation = planDonationSetup({
    real: Boolean(real),
    currencies,
    admins,
    pledgeRole: handed[2],
    cards,
    plan,
  }).map((c) => step(c.fn, c.args));
  const calls = [
    ...groups.names.map((n) => step("addGroup", [stringToHex(n, { size: 32 })])),
    ...plan.map((p) => step("addInitiative", [p.account, p.goalUsd, p.rfp, groupMask(p.groups)])),
    ...(independentTiers === 1 ? [] : [step("setIndependentTiers", [independentTiers])]),
    step("setPoolUsd", [poolUsd]),
    // Currencies, the pledge role and the pledges go before the hand-over, while the relayer
    // still holds the roles; currencies freeze at opening.
    ...donation,
    // The site's relayer, when another key deploys: it mints the badges admins give.
    ...minters.map((a) => step("grantRole", [minterRole, a])),
    ...handed.map((r) => step("grantRole", [r, ADMIN])),
    // The default admin goes last.
    ...[...handed.slice(1), handed[0]].map((r) => step("renounceRole", [r, account.address])),
  ];

  const executorArtifact = JSON.parse(
    await Deno.readTextFile(
      new URL("../vote/out/BatchExecutor.sol/BatchExecutor.json", import.meta.url),
    ),
  ) as { abi: Abi; bytecode: { object: Hex } };
  const executorReceipt = await wait(
    await wallet.deployContract({
      abi: executorArtifact.abi,
      bytecode: executorArtifact.bytecode.object,
    }),
    "BatchExecutor deploy",
  );
  const executor = executorReceipt.contractAddress!;
  // Every read after a send is made at the block it landed in: a load-balanced RPC
  // (dRPC's lb.…) can answer from a node a block or two behind, which would estimate the
  // next batch on state from before the last one. A node without that block yet errors,
  // so each read retries a few times.
  let atBlock = executorReceipt.blockNumber;
  const caughtUp = async <T>(what: string, f: () => Promise<T>): Promise<T> => {
    for (let k = 1;; k++) {
      try {
        return await f();
      } catch (e) {
        if (k >= 6) throw e;
        console.log(`  ${what}: the node may be behind block ${atBlock} (try ${k}); again in 4 s`);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };
  console.log(`BatchExecutor ${executor}; setting up ${calls.length} steps in batches`);

  // Batches: Sepolia's gas schedule puts the whole setup near 28M gas, over the ~16.7M
  // per-transaction cap (EIP-7825). Steps differ in cost (a project with affiliations or
  // a pledge costs more than a role grant), so each batch is sized by its estimate against
  // live state: it starts at half the project count (at least 25) and halves until it
  // fits. Batch 1 also delegates the account (EIP-7702); the rest find
  // the delegation in place.
  const TX_GAS_CAP = 16_700_000n;
  // A 20% margin, capped at the cap; the estimate must stay 5% under the limit.
  const limitFor = (estimate: bigint) =>
    estimate * 12n / 10n < TX_GAS_CAP ? estimate * 12n / 10n : TX_GAS_CAP;
  const fits = (estimate: bigint) => estimate <= limitFor(estimate) * 95n / 100n;
  let next = 0;
  let per = Math.max(25, Math.ceil(plan.length / 2));
  for (let i = 0; next < calls.length; i++) {
    const authorizationList = i === 0
      ? [await wallet.signAuthorization({ contractAddress: executor, executor: "self" })]
      : undefined;
    let batch: typeof calls;
    let data: Hex;
    let estimate: bigint;
    for (;;) {
      batch = calls.slice(next, next + per);
      data = encodeFunctionData({
        abi: executorArtifact.abi,
        functionName: "execute",
        args: [batch],
      });
      const [d, auth] = [data, authorizationList];
      estimate = await caughtUp(`batch ${i + 1} estimate`, () =>
        pub.estimateGas({
          account: account.address,
          to: account.address,
          data: d,
          authorizationList: auth,
          blockNumber: atBlock,
        }));
      if (fits(estimate)) break;
      if (batch.length === 1) {
        throw new Error(`step ${next + 1} alone needs ${estimate} gas, over the ${TX_GAS_CAP} cap`);
      }
      per = Math.ceil(batch.length / 2);
    }
    const gas = limitFor(estimate);
    console.log(
      `Batch ${i + 1}: steps ${next + 1}–${next + batch.length} of ${calls.length}, ` +
        `estimate ${estimate}, limit ${gas}`,
    );
    const hash = await wallet.sendTransaction({
      to: account.address,
      data,
      authorizationList,
      gas,
    });
    atBlock = (await wait(hash, `setup batch ${i + 1}`)).blockNumber;
    console.log(`  done in ${hash} (block ${atBlock})`);
    next += batch.length;
  }

  // Back to a plain account: delegate to the zero address.
  const undelegate = await wallet.signAuthorization({
    contractAddress: "0x0000000000000000000000000000000000000000",
    executor: "self",
  });
  atBlock = (await wait(
    await wallet.sendTransaction({
      to: account.address,
      value: 0n,
      authorizationList: [undelegate],
    }),
    "clear delegation",
  )).blockNumber;
  const code = await caughtUp(
    "relayer code",
    () => pub.getCode({ address: account.address, blockNumber: atBlock }),
  );
  if (code && code !== "0x") console.warn(`Note: the relayer still has code ${code}`);

  for (
    const [r, who, want] of roleChecks({
      real: Boolean(real),
      handed,
      minter: minterRole,
      admin: ADMIN,
      relayer: account.address,
      admins,
      minters,
    })
  ) {
    const has = await caughtUp("role check", () =>
      pub.readContract({
        address: contract,
        abi: SIGNED_BALLOTS_ABI,
        functionName: "hasRole",
        args: [r, who],
        blockNumber: atBlock,
      }));
    if (has !== want) throw new Error(`role ${r} for ${who} is ${has}, expected ${want}`);
  }
  const pool = await caughtUp("pool check", () =>
    pub.readContract({
      address: contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: "poolUsd",
      blockNumber: atBlock,
    }));
  if (pool !== poolUsd) throw new Error(`poolUsd ${pool} != ${poolUsd}`);

  {
    const n = await caughtUp("currency check", () =>
      pub.readContract({
        address: contract,
        abi: SIGNED_BALLOTS_ABI,
        functionName: "currencyCount",
        blockNumber: atBlock,
      }));
    if (n !== BigInt(currencies.length + 1)) throw new Error(`currencyCount ${n}`);
    // Each one as registered: the asset and feed the manifest (and the replay) will name.
    const got = await Promise.all(
      Array.from(
        { length: Number(n) },
        (_, i) =>
          caughtUp("currency check", () =>
            pub.readContract({
              address: contract,
              abi: SIGNED_BALLOTS_ABI,
              functionName: "currency",
              args: [BigInt(i)],
              blockNumber: atBlock,
            })),
      ),
    );
    const wrong = currencyMismatch([USD_CURRENCY, ...currencies], got);
    if (wrong) throw new Error(`currencies: ${wrong}`);
  }
  const now = Number((await pub.getBlock()).timestamp);
  if (now >= s.opensAt) throw new Error("Setup ran past opensAt: redeploy (the round is frozen).");
  const count = await caughtUp("initiative check", () =>
    pub.readContract({
      address: contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: "initiativeCount",
      blockNumber: atBlock,
    }));
  if (count !== BigInt(plan.length)) throw new Error(`initiativeCount ${count} != ${plan.length}`);

  console.log(
    `Round ${contract} on ${real ? "Ethereum" : "Sepolia"} is set up. Run it on the site: ` +
      `Admin → Vote, network ${real ? "Ethereum" : "Sepolia"}, this address.`,
  );
}

if (import.meta.main) await main();
