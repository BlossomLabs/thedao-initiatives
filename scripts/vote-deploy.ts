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
//     deno task vote-deploy --real --opens 2026-12-01T12:00:00Z --s-tally 2026-12-03T12:00:00Z \
//       --pool-usd 1250000 --slugs round.txt
//
// The relayer key deploys and keeps only MINTER_ROLE; it is also the server's
// sending key. Everything here must finish before opensAt (setup freezes then).
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
// Slow Quiet Ending: S's first tally a day after opening, then windows of
// 2 h, 1 h, 30 min and 15 min at most; A and B each start when the tier above
// can no longer still be running.
const VOTING_HOURS = 24;
export const INITIAL_WINDOW = 2 * 60 * 60;
export const MAX_WINDOWS = 4;
const TIER_MAX = Array.from({ length: MAX_WINDOWS }, (_, k) => INITIAL_WINDOW >> k)
  .reduce((a, b) => a + b, 0);

export type BoardCard = { slug: string; goalUsd: number; safeAddress: string };
export type PlannedInitiative = { slug: string; account: `0x${string}`; askUsd: bigint };

const placeholder = (slug: string) =>
  getAddress(slice(keccak256(toBytes(`test-round:${slug}`)), 12));

/** On-chain initiatives in the given order: the Safe when set and unused, else (test
 * votes only) a deterministic placeholder, since the contract needs unique accounts.
 * The real vote pays out to these accounts, so a missing or shared Safe stops it. */
export function planInitiatives(
  cards: BoardCard[],
  { real = false }: { real?: boolean } = {},
): PlannedInitiative[] {
  const seen = new Set<string>();
  return cards.map((c) => {
    const safe = c.safeAddress && isAddress(c.safeAddress) ? getAddress(c.safeAddress) : null;
    if (real && !safe) throw new Error(`missing Safe: ${c.slug}`);
    if (real && seen.has(safe!.toLowerCase())) throw new Error(`Safe used twice: ${c.slug}`);
    const account = safe && !seen.has(safe.toLowerCase()) ? safe : placeholder(c.slug);
    seen.add(account.toLowerCase());
    return { slug: c.slug, account, askUsd: BigInt(Math.round(c.goalUsd * 1e6)) };
  });
}

export function voteSchedule(now: number) {
  const opensAt = now + SETUP_MINUTES * 60;
  const s = opensAt + VOTING_HOURS * 60 * 60;
  return {
    opensAt,
    initialWindow: INITIAL_WINDOW,
    firstTallyAt: [s, s + TIER_MAX, s + 2 * TIER_MAX] as [number, number, number],
    maxWindows: MAX_WINDOWS,
  };
}

export type Schedule = ReturnType<typeof voteSchedule>;

/** The real vote: S's first tally where the team sets it; A and B follow once the
 * tier above can no longer be running. */
export function realSchedule(opensAt: number, sTally: number): Schedule {
  return {
    opensAt,
    initialWindow: INITIAL_WINDOW,
    firstTallyAt: [sTally, sTally + TIER_MAX, sTally + 2 * TIER_MAX],
    maxWindows: MAX_WINDOWS,
  };
}

export type RealArgs = { opensAt: number; sTally: number; poolUsd: bigint; slugsFile: string };

/** `--real` takes no defaults: the opening, S's first tally (ISO dates), the pool in
 * whole dollars and a file of initiative slugs, one per line, in ballot order. */
export function parseRealArgs(
  a: { opens?: string; "s-tally"?: string; "pool-usd"?: string; slugs?: string },
): RealArgs {
  const need = (flag: keyof typeof a) => {
    const v = a[flag]?.trim();
    if (!v) throw new Error(`--${flag} is required with --real`);
    return v;
  };
  const date = (flag: "opens" | "s-tally") => {
    const t = Date.parse(need(flag));
    if (!Number.isFinite(t)) throw new Error(`--${flag} is not a date`);
    return Math.floor(t / 1000);
  };
  const opensAt = date("opens");
  const sTally = date("s-tally");
  if (sTally <= opensAt) throw new Error("--s-tally must come after --opens");
  const dollars = need("pool-usd").replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(dollars)) throw new Error("--pool-usd must be whole dollars");
  return { opensAt, sTally, poolUsd: BigInt(dollars) * 1_000_000n, slugsFile: need("slugs") };
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
    closesAt: r.schedule.firstTallyAt[2] + TIER_MAX,
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

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["real"],
    string: ["issuer", "board", "rpc", "out", "opens", "s-tally", "pool-usd", "slugs"],
  });
  const real = args.real ? parseRealArgs(args) : null;
  const chain = real ? mainnet : sepolia;
  const key = Deno.env.get("VOTE_RELAYER_KEY")?.trim() as Hex | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("VOTE_RELAYER_KEY is required");
  const issuer = args.issuer;
  if (!real && (!issuer || !isAddress(issuer))) {
    throw new Error("--issuer <address> is required");
  }
  const rpcEnv = real ? "MAINNET_RPC_URL" : "SEPOLIA_RPC_URL";
  const rpc = args.rpc ?? Deno.env.get(rpcEnv);
  if (!rpc) throw new Error(`--rpc or ${rpcEnv} is required`);
  const boardUrl = `${
    (args.board ?? "https://initiatives.thedao.fund").replace(/\/+$/, "")
  }/api/board`;

  const account = privateKeyToAccount(key);
  // Public RPCs are slow at times: long timeouts, several retries.
  const transport = http(rpc, { timeout: 60_000, retryCount: 6, retryDelay: 1_000 });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  if ((await pub.getChainId()) !== chain.id) throw new Error(`RPC is not ${chain.name}`);

  const board = await (await fetch(boardUrl)).json() as { cards: { initiative: BoardCard }[] };
  let cards = board.cards.map((c) => c.initiative);
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
  const plan = planInitiatives(cards, { real: Boolean(real) });
  const poolUsd = real ? real.poolUsd : POOL_USD;
  console.log(`${plan.length} initiatives from ${boardUrl}`);

  const artifact = JSON.parse(
    await Deno.readTextFile(
      new URL("../vote/out/SignedBallots.sol/SignedBallots.json", import.meta.url),
    ),
  ) as { bytecode: { object: Hex } };
  const block = await pub.getBlock();
  const s = real ? realSchedule(real.opensAt, real.sTally) : voteSchedule(Number(block.timestamp));
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
    ...plan.map((p) => step("addInitiative", [p.account, p.askUsd, false, 0n])),
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
    // Task 8 registers each initiative's type and tags; until then none.
    projects: plan.map((p) => ({ askUsd: p.askUsd.toString(), rfp: false, groups: [] })),
    groups: [],
    independentTiers: 1,
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
