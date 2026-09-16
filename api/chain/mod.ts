/** Bundles the chain helpers with the per-process token state. */
import { NATIVE_ETH, TOKENS } from "../config.ts";
import { createRpc, getBlockNumber, type Rpc } from "./rpc.ts";
import { activeTokens, type TokenCheck, verifyTokens } from "./tokens.ts";
import { createPricer, type UsdRate } from "./price.ts";
import { type Verification, verifyDonationTx, type VerifyOptions } from "./verify.ts";
import { createBadgeChecker, type HasBadge } from "./badge.ts";
import { hasCode, verifySafe } from "./safe.ts";

export const CHAIN_REFRESH_SECS = 6 * 3600;

export interface ChainState {
  tokens: Record<string, TokenCheck>;
  detail: string;
  checkedAt: number;
}

export const chainStateFresh = (state: ChainState, now: number): boolean =>
  now - state.checkedAt < CHAIN_REFRESH_SECS && Object.keys(state.tokens).length > 0;

export interface Chain {
  rpc: Rpc;
  usdRate: UsdRate;
  hasBadge: HasBadge;
  /** Pass false for a snapshot that never waits on token verification. */
  state(refresh?: boolean): Promise<ChainState>;
  activeTokens(): Promise<Record<string, [string, number]>>;
  donorTokens(): Promise<Record<string, [string, number]>>;
  verifyDonation(
    txHash: string,
    recipient: string,
    opts?: Pick<VerifyOptions, "getBlockNumber">,
  ): Promise<Verification>;
  verifySafe(address: string, signers: string[]): Promise<[boolean, string]>;
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

  const state = async (revalidate = true) => {
    if (!revalidate || chainStateFresh(st, now())) return { ...st };
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
    verifyDonation: async (txHash, recipient, opts) =>
      verifyDonationTx(rpc, usdRate, txHash, recipient, await active(), opts),
    verifySafe: (address, signers) => verifySafe(rpc, address, signers),
    hasCode: (address) => hasCode(rpc, address),
    blockNumber: () => getBlockNumber(rpc),
  };
}
