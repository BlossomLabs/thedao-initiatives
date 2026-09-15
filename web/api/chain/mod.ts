/** Bundles the chain helpers with the per-process token state. */
import { NATIVE_ETH, TOKENS } from "../config.ts";
import { createRpc, getBlockNumber, type Rpc } from "./rpc.ts";
import { activeTokens, type TokenCheck, verifyTokens } from "./tokens.ts";
import { createPricer, type UsdRate } from "./price.ts";
import { type Verification, verifyDonationTx } from "./verify.ts";
import { createBadgeChecker, type HasBadge } from "./badge.ts";
import { extractDeployedSafe, hasCode, resolveSafe, verifySafe } from "./safe.ts";

export const CHAIN_REFRESH_SECS = 6 * 3600;

export interface ChainState {
  tokens: Record<string, TokenCheck>;
  detail: string;
  checkedAt: number;
}

export interface Chain {
  rpc: Rpc;
  usdRate: UsdRate;
  hasBadge: HasBadge;
  state(): Promise<ChainState>;
  activeTokens(): Promise<Record<string, [string, number]>>;
  donorTokens(): Promise<Record<string, [string, number]>>;
  verifyDonation(txHash: string, recipient: string): Promise<Verification>;
  extractDeployedSafe(txHash: string): Promise<[string, null] | [null, string]>;
  verifySafe(address: string, signers: string[]): Promise<[boolean, string]>;
  /** The CREATE2 address of this initiative's Safe, chain-checked; throws if unsure. */
  resolveSafe(
    signers: string[],
    deploymentKey: string,
  ): Promise<{ address: string; deployed: boolean }>;
  hasCode(address: string): Promise<boolean>;
  blockNumber(): Promise<number>;
}

export interface ChainOptions {
  rpc?: Rpc;
  endpoints?: string[];
  fetch?: typeof fetch;
  now?: () => number;
  tokens?: Record<string, [string, number]>;
}

export function createChain(opts: ChainOptions = {}): Chain {
  const now = opts.now ?? (() => Date.now() / 1000);
  const rpc = opts.rpc ??
    createRpc({ endpoints: opts.endpoints ?? [], fetch: opts.fetch });
  const usdRate = createPricer(rpc, now);
  const hasBadge = createBadgeChecker(rpc, now);
  const tokens = opts.tokens ?? TOKENS;
  const st: ChainState = { tokens: {}, detail: "not yet checked", checkedAt: 0 };
  let inflight: Promise<ChainState> | null = null;

  async function refresh(): Promise<ChainState> {
    try {
      const t = await verifyTokens(rpc, tokens);
      const okN = Object.values(t).filter((x) => x.ok).length;
      st.tokens = t;
      st.detail = `${okN}/${Object.keys(t).length} tokens verified on-chain`;
      st.checkedAt = now();
    } catch (e) {
      st.detail = `chain check failed: ${String(e)}`;
      st.checkedAt = now() - CHAIN_REFRESH_SECS + 300; // retry in 5 min
    }
    return { ...st };
  }

  const state = async () => {
    const fresh = now() - st.checkedAt < CHAIN_REFRESH_SECS;
    if (fresh && Object.keys(st.tokens).length) return { ...st };
    if (!inflight) inflight = refresh().finally(() => (inflight = null));
    return await inflight;
  };
  const active = async () => activeTokens((await state()).tokens);

  return {
    rpc,
    usdRate,
    hasBadge,
    state,
    activeTokens: active,
    donorTokens: async () => {
      const out = { ...(await active()) };
      if (NATIVE_ETH) out.ETH = ["native", 18];
      return out;
    },
    verifyDonation: async (txHash, recipient) =>
      verifyDonationTx(rpc, usdRate, txHash, recipient, await active()),
    extractDeployedSafe: (txHash) => extractDeployedSafe(rpc, txHash),
    verifySafe: (address, signers) => verifySafe(rpc, address, signers),
    resolveSafe: (signers, key) => resolveSafe(rpc, signers, key),
    hasCode: (address) => hasCode(rpc, address),
    blockNumber: () => getBlockNumber(rpc),
  };
}
