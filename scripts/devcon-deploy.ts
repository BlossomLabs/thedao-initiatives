// Deploys the Devcon 8 SignedBallots round on Sepolia, sets it up, hands the admin
// roles to sem-the-bee.eth and writes shared/devcon/manifest.json.
//
//   DEVCON_RELAYER_KEY=0x… SEPOLIA_RPC_URL=https://… \
//     deno task devcon-deploy --issuer 0x… [--board https://initiatives.thedao.fund] [--rpc http://127.0.0.1:8545]
//
// The relayer key deploys and keeps only MINTER_ROLE; it is also the server's
// sending key. Everything here must finish before opensAt (setup freezes then).
import { parseArgs } from "jsr:@std/cli@1.0.24/parse-args";
import {
  createPublicClient,
  createWalletClient,
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
import { SIGNED_BALLOTS_ABI } from "../shared/devcon/abi.ts";
import { DEVCON_CLOSE, type DevconManifest } from "../shared/devcon/manifest.ts";

export const ADMIN = "0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF"; // sem-the-bee.eth
export const POOL_USD = 913_244_000_000n; // 400 ETH × $2,283.11, six decimals
const SETUP_MINUTES = 15;

export type BoardCard = { slug: string; goalUsd: number; safeAddress: string };
export type PlannedInitiative = { slug: string; account: `0x${string}`; askUsd: bigint };

const placeholder = (slug: string) => getAddress(slice(keccak256(toBytes(`devcon8:${slug}`)), 12));

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

export function devconSchedule(now: number) {
  return {
    opensAt: now + SETUP_MINUTES * 60,
    initialWindow: 1,
    firstTallyAt: [DEVCON_CLOSE - 1, DEVCON_CLOSE, DEVCON_CLOSE + 1] as [number, number, number],
    maxWindows: 1,
  };
}

async function main() {
  const args = parseArgs(Deno.args, { string: ["issuer", "board", "rpc", "out"] });
  const key = Deno.env.get("DEVCON_RELAYER_KEY")?.trim() as Hex | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("DEVCON_RELAYER_KEY is required");
  const issuer = args.issuer;
  if (!issuer || !isAddress(issuer)) throw new Error("--issuer <address> is required");
  const rpc = args.rpc ?? Deno.env.get("SEPOLIA_RPC_URL");
  if (!rpc) throw new Error("--rpc or SEPOLIA_RPC_URL is required");
  const boardUrl = `${
    (args.board ?? "https://initiatives.thedao.fund").replace(/\/+$/, "")
  }/api/board`;

  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
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
  const s = devconSchedule(Number(block.timestamp));
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
      "TheDAO Devcon 8",
      "DEVCON",
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

  const call = async (functionName: string, fnArgs: readonly unknown[]) => {
    const hash = await wallet.writeContract({
      address: contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: functionName as never,
      args: fnArgs as never,
    });
    await wait(hash, functionName);
  };
  for (const [i, p] of plan.entries()) {
    await call("addInitiative", [p.account, p.askUsd]);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${plan.length} initiatives`);
  }
  await call("setPoolUsd", [POOL_USD]);
  const role = (name: string) =>
    pub.readContract({
      address: contract,
      abi: SIGNED_BALLOTS_ABI,
      functionName: name as never,
    }) as Promise<Hex>;
  const handed = await Promise.all(["DEFAULT_ADMIN_ROLE", "ADMIN_ROLE", "PLEDGE_ROLE"].map(role));
  for (const r of handed) await call("grantRole", [r, ADMIN]);
  // The default admin goes last: renouncing it first would still work, but this keeps the order obvious.
  for (const r of [...handed.slice(1), await role("BLOB_SUBMITTER_ROLE"), handed[0]]) {
    await call("renounceRole", [r, account.address]);
  }

  const now = Number((await pub.getBlock()).timestamp);
  if (now >= s.opensAt) throw new Error("Setup ran past opensAt: redeploy (the round is frozen).");
  const count = await pub.readContract({
    address: contract,
    abi: SIGNED_BALLOTS_ABI,
    functionName: "initiativeCount",
  });
  if (count !== BigInt(plan.length)) throw new Error(`initiativeCount ${count} != ${plan.length}`);

  const manifest: DevconManifest = {
    chainId: sepolia.id,
    contract,
    deployBlock: Number(deployed.blockNumber),
    opensAt: s.opensAt,
    closesAt: DEVCON_CLOSE,
    poolUsd: POOL_USD.toString(),
    issuer: getAddress(issuer),
    slugs: plan.map((p) => p.slug),
  };
  const out = args.out ?? new URL("../shared/devcon/manifest-data.ts", import.meta.url).pathname;
  await Deno.writeTextFile(
    out,
    `// Written by scripts/devcon-deploy.ts. Do not edit by hand.\nexport default ${
      JSON.stringify(manifest, null, 2)
    };\n`,
  );
  console.log(`Manifest written to ${out}`);
}

if (import.meta.main) await main();
