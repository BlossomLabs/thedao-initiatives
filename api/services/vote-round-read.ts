import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  erc20Abi,
  getAddress,
  hexToString,
  http,
  type PublicClient,
  type Transport,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import { SIGNED_BALLOTS_ABI } from "../../shared/vote/abi.ts";
import { type RoundOnChain, RoundReadError } from "../../shared/vote/round-from-chain.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

const isRevert = (e: unknown) =>
  e instanceof BaseError &&
  Boolean(
    e.walk((x) =>
      x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError
    ),
  );

/** The block a contract was deployed in: the first with its code (needs an archive node). */
export async function deployBlockOf(
  pub: PublicClient,
  address: `0x${string}`,
  chainName = "Sepolia",
): Promise<number> {
  const head = Number(await pub.getBlockNumber());
  const has = async (n: number) =>
    ((await pub.getCode({ address, blockNumber: BigInt(n) })) ?? "0x") !== "0x";
  if (!(await has(head))) {
    throw new RoundReadError(`There's no contract at that address on ${chainName}.`);
  }
  let lo = 0, hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await has(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Everything a round's contract says about itself, read at the newest block: on Sepolia
 * (a test round) or Ethereum (the real vote). */
export async function readRoundOnChain(
  address: `0x${string}`,
  rpcUrl: string,
  transport: Transport = http(rpcUrl),
  chainId: 1 | 11155111 = 11155111,
): Promise<RoundOnChain & { minters: (a: `0x${string}`) => Promise<boolean> }> {
  const chain = chainId === mainnet.id ? mainnet : sepolia;
  const chainName = chainId === mainnet.id ? "Ethereum" : "Sepolia";
  // The reads go out as a few multicalls, not one request each (80+ initiatives).
  const pub = createPublicClient({
    chain,
    transport,
    batch: { multicall: true },
  }) as PublicClient;
  const c = { address: getAddress(address), abi: SIGNED_BALLOTS_ABI } as const;
  const one = <T>(functionName: string, args: unknown[] = []) =>
    pub.readContract({ ...c, functionName, args } as never) as Promise<T>;
  /** A revert (or no code to answer) means the contract isn't one; a node that can't be
   * reached is thrown as it is. */
  const unless = (message: string) => (e: unknown): never => {
    throw isRevert(e) ? new RoundReadError(message) : e;
  };
  const counts = await Promise.all([
    one<bigint>("initiativeCount"),
    one<bigint>("currencyCount"),
  ]).catch(unless(`That address isn't a vote round on ${chainName}.`));
  // Rounds from before the ballot rules have no affiliations (groups) to read.
  const nGroups = await one<bigint>("groupCount").catch(
    unless("That round was deployed before the ballot rules: deploy a new one with vote-deploy."),
  );
  const [nI, nC] = counts.map(Number);
  const nG = Number(nGroups);
  const range = (n: number) => Array.from({ length: n }, (_, i) => BigInt(i));
  const [opensAt, initialWindow, maxWindows, t0, t1, t2, poolUsd, independentTiers] = await Promise
    .all([
      one<bigint>("opensAt"),
      one<bigint>("initialWindow"),
      one<number>("maxWindows"),
      one<bigint>("firstTallyAt", [0n]),
      one<bigint>("firstTallyAt", [1n]),
      one<bigint>("firstTallyAt", [2n]),
      one<bigint>("poolUsd"),
      one<number>("independentTiers"),
    ]);
  const [initiatives, groupNames, currencies, deployBlock] = await Promise.all([
    Promise.all(
      range(nI).map((i) =>
        one<{ account: `0x${string}`; rfp: boolean; goalUsd: bigint; groups: bigint }>(
          "initiative",
          [i],
        )
      ),
    ),
    Promise.all(range(nG).map((i) => one<`0x${string}`>("groupName", [i]))),
    Promise.all(
      range(nC).map(async (i) => {
        const x = await one<{ asset: `0x${string}`; usdFeed: `0x${string}` }>("currency", [i]);
        const symbol = i === 0n
          ? "USD"
          : x.asset === ZERO
          ? "ETH"
          : await pub.readContract({ address: x.asset, abi: erc20Abi, functionName: "symbol" });
        return { symbol, asset: getAddress(x.asset), usdFeed: getAddress(x.usdFeed) };
      }),
    ),
    deployBlockOf(pub, c.address, chainName),
  ]);
  const [minter, eligibilityNFT] = await Promise.all([
    one<`0x${string}`>("MINTER_ROLE"),
    one<`0x${string}`>("eligibilityNFT"),
  ]);
  return {
    chainId,
    eligibilityNFT: getAddress(eligibilityNFT),
    deployBlock,
    schedule: {
      opensAt: Number(opensAt),
      firstTallyAt: [Number(t0), Number(t1), Number(t2)],
      initialWindow: Number(initialWindow),
      maxWindows: Number(maxWindows),
    },
    poolUsd,
    independentTiers: Number(independentTiers),
    initiatives: initiatives.map((x) => ({
      account: getAddress(x.account),
      rfp: x.rfp,
      goalUsd: x.goalUsd,
      groups: x.groups,
    })),
    groups: groupNames.map((h) => hexToString(h, { size: 32 }).replace(/\0+$/, "")),
    currencies,
    minters: (a) => one<boolean>("hasRole", [minter, a]),
  };
}
