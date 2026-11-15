import type { VoteManifest } from "./manifest.ts";

/** TestUSD (vote/contracts/TestUSD.sol): a test round's dollar on Sepolia. Anyone may mint
 * it, to any account, up to `TEST_USD_MAX_MINT` at a time. */
export const TEST_USD_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

/** A million test dollars, six decimals: the most one mint gives. */
export const TEST_USD_MAX_MINT = 1_000_000;

/** Where a test round's donation goes: its test dollar and the initiative's account on
 * Sepolia; null when the round has neither (a real round, or one from before them). */
export function testDonation(
  m: VoteManifest,
  slug: string,
): { token: `0x${string}`; account: `0x${string}` } | null {
  if (m.kind !== "test") return null;
  const token = m.currencies?.find((c) => c.symbol === "tUSD")?.asset;
  const account = m.accounts?.[m.slugs.indexOf(slug)];
  return token && account ? { token, account } : null;
}
