// Deploys a SignedBallots round, sets it up, hands the admin roles to
// sem-the-bee.eth and writes shared/vote/manifest-data.ts.
//
// A test vote, on Sepolia, with paper codes and the board's initiatives:
//   VOTE_RELAYER_KEY=0x… SEPOLIA_RPC_URL=https://… \
//     deno task vote-deploy --issuer 0x… [--board https://initiatives.thedao.fund] [--rpc http://127.0.0.1:8545]
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
//   deno task vote-deploy --add slug-a,slug-b [--rpc …] > add.json   (Safe Transaction Builder batch)
//   … the admin executes it …
//   deno task vote-deploy --added slug-a,slug-b [--rpc …]            (checks on-chain, appends to the manifest)
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
  keccak256,
  slice,
  stringToHex,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";
import { REVIEW_BADGE_CONTRACT } from "../api/config.ts";
import { SIGNED_BALLOTS_ABI } from "../shared/vote/abi.ts";
import type { VoteManifest } from "../shared/vote/manifest.ts";

export const ADMIN = "0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF"; // sem-the-bee.eth
export const POOL_USD = 913_244_000_000n; // 400 ETH × $2,283.11, six decimals
const SETUP_MINUTES = 30;
// A test vote: S's first tally a day after opening, then windows of 2 h, 1 h,
// 30 min and 15 min at most; A and B each start when the tier above can no longer
// still be running.
const VOTING_HOURS = 24;
export const TEST_WINDOWS = { initialWindow: 2 * 60 * 60, maxWindows: 4 };
// The real vote: 24 h, 12 h, 6 h, 3 h, 1 h 30 min, 45 min, 22 min 30 s, 11 min 15 s and
// 5 min 37 s: 9 windows, 47 h 54 min 22 s at most.
export const REAL_WINDOWS = { initialWindow: 24 * 60 * 60, maxWindows: 9 };

/** The longest a tier can run: every window, as the contract adds them up. */
export const tierMax = (s: { initialWindow: number; maxWindows: number }) =>
  Array.from({ length: s.maxWindows }, (_, k) => s.initialWindow >> k).reduce((a, b) => a + b, 0);

export type BoardCard = {
  slug: string;
  goalUsd: number;
  safeAddress: string;
  type?: "rfp" | "grant";
  /** From /api/initiatives/affiliations (the board doesn't carry them). */
  affiliations?: string[];
};
export type PlannedInitiative = {
  slug: string;
  account: `0x${string}`;
  askUsd: bigint;
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

const placeholder = (slug: string) =>
  getAddress(slice(keccak256(toBytes(`test-round:${slug}`)), 12));

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
      askUsd: BigInt(Math.round(c.goalUsd * 1e6)),
      rfp: c.type === "rfp",
      groups: groups.groupsOf(c.slug),
    };
  });
}

export function voteSchedule(now: number) {
  const opensAt = now + SETUP_MINUTES * 60;
  const s = opensAt + VOTING_HOURS * 60 * 60;
  const span = tierMax(TEST_WINDOWS);
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

/** What the site reads (shared/vote/manifest-data.ts). */
export function manifestFor(
  r: {
    kind: "test" | "real";
    contract: `0x${string}`;
    deployBlock: number;
    schedule: Schedule;
    poolUsd: bigint;
    issuer?: `0x${string}`;
    slugs: string[];
    projects: VoteManifest["projects"];
    groups: string[];
    independentTiers: number;
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
    ...(r.kind === "real" ? { badge: REVIEW_BADGE_CONTRACT } : { issuer: getAddress(r.issuer!) }),
    slugs: r.slugs,
    projects: r.projects,
    groups: r.groups,
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
      args: [p.account, p.askUsd, p.rfp, groupMask(p.groups)] as const,
    })),
  ];
  return {
    calls,
    manifest: {
      ...m,
      slugs: [...m.slugs, ...plan.map((p) => p.slug)],
      projects: [
        ...m.projects,
        ...plan.map((p) => ({ askUsd: p.askUsd.toString(), rfp: p.rfp, groups: p.groups })),
      ],
      groups: groups.names,
    },
  };
}

/** The board's initiatives with their affiliations (the board itself doesn't carry them). */
async function boardCards(board = "https://initiatives.thedao.fund"): Promise<BoardCard[]> {
  const base = board.replace(/\/+$/, "");
  const [b, a] = await Promise.all([
    fetch(`${base}/api/board`).then((r) => r.json()) as Promise<{
      cards: { initiative: BoardCard }[];
    }>,
    fetch(`${base}/api/initiatives/affiliations`).then((r) => r.json()) as Promise<{
      affiliations: Record<string, string[]>;
    }>,
  ]);
  return b.cards.map((c) => ({ ...c.initiative, affiliations: a.affiliations[c.initiative.slug] }));
}

/** --add: the admin's calls as a Safe Transaction Builder batch, if adding is open now.
 * --added: after the admin ran them, checks each project on-chain and appends it to
 * the manifest. */
async function addMain(
  args: { add?: string; added?: string; board?: string; rpc?: string; out?: string },
) {
  const m = (await import("../shared/vote/manifest-data.ts")).default as unknown as VoteManifest;
  const chain = m.chainId === mainnet.id ? mainnet : sepolia;
  const rpc = args.rpc ??
    Deno.env.get(chain.id === mainnet.id ? "MAINNET_RPC_URL" : "SEPOLIA_RPC_URL");
  if (!rpc) throw new Error("--rpc or the chain's RPC env var is required");
  const pub = createPublicClient({
    chain,
    transport: http(rpc, { timeout: 60_000, retryCount: 6 }),
  });
  const slugs = (args.add ?? args.added)!.split(",").map((x) => x.trim()).filter(Boolean);
  const bySlug = new Map((await boardCards(args.board)).map((c) => [c.slug, c]));
  const cards = slugs.map((slug) => {
    const c = bySlug.get(slug);
    if (!c) throw new Error(`not on the board: ${slug}`);
    return c;
  });
  const { calls, manifest } = addPlan(m, cards);
  if (args.add) {
    const now = Number((await pub.getBlock()).timestamp);
    if (!addingOpen(m.schedule, now)) {
      const next = nextAddingOpen(m.schedule, now);
      throw new Error(
        next === null
          ? "Adding is closed: the round is over."
          : `Adding is closed until ${new Date(next * 1000).toISOString()}`,
      );
    }
    const batch = {
      version: "1.0",
      chainId: String(chain.id),
      meta: { name: `Add ${slugs.join(", ")} to the vote` },
      transactions: calls.map((c) => ({
        to: m.contract,
        value: "0",
        data: encodeFunctionData({
          abi: SIGNED_BALLOTS_ABI,
          functionName: c.fn,
          args: c.args as never,
        }),
      })),
    };
    console.log(JSON.stringify(batch, null, 2));
    return;
  }
  const read = (functionName: string, a: readonly unknown[] = []) =>
    pub.readContract({
      address: m.contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: functionName as never,
      args: a as never,
    });
  const count = Number(await read("initiativeCount"));
  if (count !== manifest.slugs.length) {
    throw new Error(
      `initiativeCount ${count}, expected ${manifest.slugs.length}: run the batch first`,
    );
  }
  for (const [i, name] of manifest.groups.entries()) {
    if (await read("groupName", [BigInt(i)]) !== stringToHex(name, { size: 32 })) {
      throw new Error(`group ${i} on-chain isn't ${name}`);
    }
  }
  const plan = planInitiatives(cards, {
    real: m.kind === "real",
    groups: planGroups(cards, m.groups),
  });
  for (const [k, p] of plan.entries()) {
    const x = await read("initiative", [BigInt(m.slugs.length + k)]) as {
      account: string;
      askUsd: bigint;
      rfp: boolean;
      groups: bigint;
    };
    if (
      x.account.toLowerCase() !== p.account.toLowerCase() || x.askUsd !== p.askUsd ||
      x.rfp !== p.rfp || x.groups !== groupMask(p.groups)
    ) throw new Error(`initiative ${m.slugs.length + k} on-chain doesn't match ${p.slug}`);
  }
  const out = args.out ?? new URL("../shared/vote/manifest-data.ts", import.meta.url).pathname;
  await Deno.writeTextFile(
    out,
    `// Written by scripts/vote-deploy.ts. Do not edit by hand.\nexport default ${
      JSON.stringify(manifest, null, 2)
    };\n`,
  );
  console.log(`Appended ${slugs.join(", ")}; manifest written to ${out}`);
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["real"],
    string: [
      "issuer",
      "board",
      "rpc",
      "out",
      "opens",
      "s-tally",
      "a-tally",
      "b-tally",
      "pool-usd",
      "slugs",
      "independent-tiers",
      "add",
      "added",
    ],
  });
  if (args.add || args.added) return await addMain(args);
  const independentTiers = Number(args["independent-tiers"] ?? 1);
  if (independentTiers !== 1 && independentTiers !== 3) {
    throw new Error("--independent-tiers is 1 (S-Tier) or 3 (S-Tier and A-Tier)");
  }
  const real = args.real ? parseRealArgs(args) : null;
  const chain = real ? mainnet : sepolia;
  // DEVCON_RELAYER_KEY: the name before the rename, still accepted.
  const key = (Deno.env.get("VOTE_RELAYER_KEY") || Deno.env.get("DEVCON_RELAYER_KEY"))?.trim() as
    | Hex
    | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("VOTE_RELAYER_KEY is required");
  const issuer = args.issuer;
  if (!real && (!issuer || !isAddress(issuer))) {
    throw new Error("--issuer <address> is required");
  }
  const rpcEnv = real ? "MAINNET_RPC_URL" : "SEPOLIA_RPC_URL";
  const rpc = args.rpc ?? Deno.env.get(rpcEnv);
  if (!rpc) throw new Error(`--rpc or ${rpcEnv} is required`);

  const account = privateKeyToAccount(key);
  // Public RPCs are slow at times: long timeouts, several retries.
  const transport = http(rpc, { timeout: 60_000, retryCount: 6, retryDelay: 1_000 });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  if ((await pub.getChainId()) !== chain.id) throw new Error(`RPC is not ${chain.name}`);

  let cards = await boardCards(args.board);
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
  const poolUsd = real ? real.poolUsd : POOL_USD;
  console.log(`${plan.length} initiatives, ${groups.names.length} affiliations`);

  const artifact = JSON.parse(
    await Deno.readTextFile(
      new URL("../vote/out/SignedBallots.sol/SignedBallots.json", import.meta.url),
    ),
  ) as { bytecode: { object: Hex } };
  const block = await pub.getBlock();
  const s = real ? realSchedule(real.opensAt, real.tallies) : voteSchedule(Number(block.timestamp));
  if (real && Number(block.timestamp) + SETUP_MINUTES * 60 > s.opensAt) {
    throw new Error(`--opens must leave ${SETUP_MINUTES} minutes for the setup`);
  }
  const wait = async (hash: Hex, what: string) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
    return r;
  };

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
  const role = (name: string) =>
    pub.readContract({
      address: contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: name as never,
    }) as Promise<Hex>;
  const handed = await Promise.all(["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE", "PLEDGE_ROLE"].map(role));
  const blob = await role("BLOB_SUBMITTER_ROLE");
  const step = (functionName: string, fnArgs: readonly unknown[]) => ({
    to: contract,
    value: 0n,
    data: encodeFunctionData({
      abi: SIGNED_BALLOTS_ABI,
      functionName: functionName as never,
      args: fnArgs as never,
    }),
  });
  const calls = [
    ...groups.names.map((n) => step("addGroup", [stringToHex(n, { size: 32 })])),
    ...plan.map((p) => step("addInitiative", [p.account, p.askUsd, p.rfp, groupMask(p.groups)])),
    ...(independentTiers === 1 ? [] : [step("setIndependentTiers", [independentTiers])]),
    step("setPoolUsd", [poolUsd]),
    ...handed.map((r) => step("grantRole", [r, ADMIN])),
    // The default admin goes last.
    ...[...handed.slice(1), blob, handed[0]].map((r) => step("renounceRole", [r, account.address])),
  ];

  const executorArtifact = JSON.parse(
    await Deno.readTextFile(
      new URL("../vote/out/BatchExecutor.sol/BatchExecutor.json", import.meta.url),
    ),
  ) as { abi: Abi; bytecode: { object: Hex } };
  const executor = (await wait(
    await wallet.deployContract({
      abi: executorArtifact.abi,
      bytecode: executorArtifact.bytecode.object,
    }),
    "BatchExecutor deploy",
  )).contractAddress!;
  console.log(`BatchExecutor ${executor}; setting up ${calls.length} steps in two batches`);

  // Two batches: Sepolia's gas schedule puts the whole setup near 28M gas, over
  // the ~16.7M per-transaction cap (EIP-7825). Batch 1 also delegates the account
  // (EIP-7702); batch 2 finds the delegation in place. Each batch is estimated
  // against live state and refused before sending if it can't fit.
  const TX_GAS_CAP = 16_700_000n;
  const half = Math.ceil(plan.length / 2);
  const batches = [calls.slice(0, half), calls.slice(half)];
  for (const [i, batch] of batches.entries()) {
    const authorizationList = i === 0
      ? [await wallet.signAuthorization({ contractAddress: executor, executor: "self" })]
      : undefined;
    const data = encodeFunctionData({
      abi: executorArtifact.abi,
      functionName: "execute",
      args: [batch],
    });
    const estimate = await pub.estimateGas({
      account: account.address,
      to: account.address,
      data,
      authorizationList,
    });
    const gas = estimate * 12n / 10n < TX_GAS_CAP ? estimate * 12n / 10n : TX_GAS_CAP;
    if (estimate > gas * 95n / 100n) {
      throw new Error(`batch ${i + 1} needs ${estimate} gas, too close to the ${TX_GAS_CAP} cap`);
    }
    console.log(`Batch ${i + 1}/2: ${batch.length} steps, estimate ${estimate}, limit ${gas}`);
    const hash = await wallet.sendTransaction({
      to: account.address,
      data,
      authorizationList,
      gas,
    });
    await wait(hash, `setup batch ${i + 1}`);
    console.log(`  done in ${hash}`);
  }

  // Back to a plain account: delegate to the zero address.
  const undelegate = await wallet.signAuthorization({
    contractAddress: "0x0000000000000000000000000000000000000000",
    executor: "self",
  });
  await wait(
    await wallet.sendTransaction({
      to: account.address,
      value: 0n,
      authorizationList: [undelegate],
    }),
    "clear delegation",
  );
  const code = await pub.getCode({ address: account.address });
  if (code && code !== "0x") console.warn(`Note: the relayer still has code ${code}`);

  const minter = await role("MINTER_ROLE");
  for (
    const [r, who, want] of [
      [handed[0], ADMIN, true],
      [handed[1], ADMIN, true],
      [handed[0], account.address, false],
      [handed[1], account.address, false],
      // A test vote's relayer mints the paper-code badges.
      ...(real ? [] : [[minter, account.address, true] as const]),
    ] as const
  ) {
    const has = await pub.readContract({
      address: contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: "hasRole",
      args: [r, who],
    });
    if (has !== want) throw new Error(`role ${r} for ${who} is ${has}, expected ${want}`);
  }
  const pool = await pub.readContract({
    address: contract,
    abi: SIGNED_BALLOTS_ABI,
    functionName: "poolUsd",
  });
  if (pool !== poolUsd) throw new Error(`poolUsd ${pool} != ${poolUsd}`);

  const now = Number((await pub.getBlock()).timestamp);
  if (now >= s.opensAt) throw new Error("Setup ran past opensAt: redeploy (the round is frozen).");
  const count = await pub.readContract({
    address: contract,
    abi: SIGNED_BALLOTS_ABI,
    functionName: "initiativeCount",
  });
  if (count !== BigInt(plan.length)) throw new Error(`initiativeCount ${count} != ${plan.length}`);

  const manifest = manifestFor({
    kind: real ? "real" : "test",
    contract,
    deployBlock: Number(deployed.blockNumber),
    schedule: s,
    poolUsd,
    issuer: issuer as `0x${string}` | undefined,
    slugs: plan.map((p) => p.slug),
    projects: plan.map((p) => ({ askUsd: p.askUsd.toString(), rfp: p.rfp, groups: p.groups })),
    groups: groups.names,
    independentTiers,
  });
  const out = args.out ?? new URL("../shared/vote/manifest-data.ts", import.meta.url).pathname;
  await Deno.writeTextFile(
    out,
    `// Written by scripts/vote-deploy.ts. Do not edit by hand.\nexport default ${
      JSON.stringify(manifest, null, 2)
    };\n`,
  );
  console.log(`Manifest written to ${out}`);
}

if (import.meta.main) await main();
