// Deploys a test SignedBallots round on Sepolia, sets it up, hands the admin
// roles to sem-the-bee.eth and writes shared/vote/manifest.json.
//
//   VOTE_RELAYER_KEY=0x… SEPOLIA_RPC_URL=https://… \
//     deno task vote-deploy --issuer 0x… [--board https://initiatives.thedao.fund] [--rpc http://127.0.0.1:8545]
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
import { sepolia } from "viem/chains";
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

/** On-chain initiatives in board order: the Safe when set and unused, else a
 * deterministic placeholder (the contract needs unique accounts). */
export function planInitiatives(cards: BoardCard[]): PlannedInitiative[] {
  const seen = new Set<string>();
  return cards.map((c) => {
    const safe = c.safeAddress && isAddress(c.safeAddress) ? getAddress(c.safeAddress) : null;
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

async function main() {
  const args = parseArgs(Deno.args, { string: ["issuer", "board", "rpc", "out"] });
  const key = Deno.env.get("VOTE_RELAYER_KEY")?.trim() as Hex | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("VOTE_RELAYER_KEY is required");
  const issuer = args.issuer;
  if (!issuer || !isAddress(issuer)) throw new Error("--issuer <address> is required");
  const rpc = args.rpc ?? Deno.env.get("SEPOLIA_RPC_URL");
  if (!rpc) throw new Error("--rpc or SEPOLIA_RPC_URL is required");
  const boardUrl = `${
    (args.board ?? "https://initiatives.thedao.fund").replace(/\/+$/, "")
  }/api/board`;

  const account = privateKeyToAccount(key);
  // Public Sepolia RPCs are slow at times: long timeouts, several retries.
  const transport = http(rpc, { timeout: 60_000, retryCount: 6, retryDelay: 1_000 });
  const pub = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  if ((await pub.getChainId()) !== sepolia.id) throw new Error("RPC is not Sepolia");

  const board = await (await fetch(boardUrl)).json() as { cards: { initiative: BoardCard }[] };
  const plan = planInitiatives(board.cards.map((c) => c.initiative));
  console.log(`${plan.length} initiatives from ${boardUrl}`);

  const artifact = JSON.parse(
    await Deno.readTextFile(
      new URL("../vote/out/SignedBallots.sol/SignedBallots.json", import.meta.url),
    ),
  ) as { bytecode: { object: Hex } };
  const block = await pub.getBlock();
  const s = voteSchedule(Number(block.timestamp));
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
      "0x0000000000000000000000000000000000000000",
      "TheDAO test vote",
      "ROUND",
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
    ...plan.map((p) => step("addInitiative", [p.account, p.askUsd])),
    step("setPoolUsd", [POOL_USD]),
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
      [minter, account.address, true],
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
  if (pool !== POOL_USD) throw new Error(`poolUsd ${pool} != ${POOL_USD}`);

  const now = Number((await pub.getBlock()).timestamp);
  if (now >= s.opensAt) throw new Error("Setup ran past opensAt: redeploy (the round is frozen).");
  const count = await pub.readContract({
    address: contract,
    abi: SIGNED_BALLOTS_ABI,
    functionName: "initiativeCount",
  });
  if (count !== BigInt(plan.length)) throw new Error(`initiativeCount ${count} != ${plan.length}`);

  const manifest: VoteManifest = {
    kind: "test",
    chainId: sepolia.id,
    contract,
    deployBlock: Number(deployed.blockNumber),
    opensAt: s.opensAt,
    // Until the app follows the quiet ending, the site closes at S's first tally.
    closesAt: s.firstTallyAt[0],
    poolUsd: POOL_USD.toString(),
    issuer: getAddress(issuer),
    slugs: plan.map((p) => p.slug),
  };
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
