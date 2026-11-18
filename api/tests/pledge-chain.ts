/** The vote contract's pledges, faked for the admin pledge tests: a round, a chain that
 * does what setPledgeBySig does, and a wallet signing the typed data `prepare` answers. */
import { privateKeyToAccount } from "viem/accounts";
import { type Hex, verifyTypedData } from "viem";
import type { VoteChain } from "../services/vote-chain.ts";
import type { VoteManifest } from "../../shared/vote/manifest.ts";
import { pledgeTypedData } from "../../shared/vote/typed-data.ts";

// ADMIN's key (app-helpers: wallet("0x11..11")).
export const ADMIN_KEY = privateKeyToAccount(`0x${"11".repeat(32)}`);
export const OTHER = privateKeyToAccount(`0x${"33".repeat(32)}`);
export const NOW = 1_800_000_000;
export const RELAYER = "0x9000000000000000000000000000000000000009" as const;

export const roundOf = (slugs: string[], kind: "real" | "test" = "real"): VoteManifest => ({
  kind,
  chainId: kind === "real" ? 1 : 11155111,
  contract: "0x1000000000000000000000000000000000000001",
  ...(kind === "real" ? { badge: "0x3B49f45EC8796F64feBB1Ae0f5661791845ce35C" as const } : {}),
  deployBlock: 1,
  opensAt: NOW - 3600,
  closesAt: NOW + 3600,
  schedule: {
    opensAt: NOW - 3600,
    firstTallyAt: [NOW + 600, NOW + 660, NOW + 720],
    initialWindow: 60,
    maxWindows: 1,
  },
  poolUsd: "913244000000",
  slugs,
  projects: slugs.map(() => ({ goalUsd: "1", rfp: false, groups: [] })),
  groups: [],
  independentTiers: 1,
});

export type PledgeCall = {
  pledgeId: Hex;
  initiativeId: bigint;
  currencyId: bigint;
  amount: bigint;
  signer: Hex;
  nonce: bigint;
  deadline: bigint;
};

/** A chain that does what setPledgeBySig does: consecutive nonces per signer, the
 * signature checked against the signer, the pledge set (re-homed if it existed). A
 * transaction lands at once unless `receipt` says otherwise; `land` and `revert` settle
 * one later. */
export function fakeChain(m: VoteManifest) {
  const state = {
    nonces: new Map<string, bigint>(),
    sent: [] as PledgeCall[],
    /** What happens to the next transactions. */
    receipt: "success" as "success" | "reverted" | "pending",
    statuses: new Map<Hex, "success" | "reverted" | "pending">(),
    /** The contract's `pledges(bytes32)`. */
    pledges: new Map<Hex, { initiativeId: bigint; currencyId: bigint; amount: bigint }>(),
    byHash: new Map<Hex, PledgeCall>(),
    /** The node's receipt lookups fail (an RPC error). */
    txStatusFails: false,
    /** The send goes out, then the call throws (a failed write after the broadcast). */
    throwAfterSend: false,
    /** The block each nonce and pledge read named (undefined: the head). */
    reads: [] as [string, bigint | undefined][],
    /** Wallets without the round's roles (lower case): the second site admin's. */
    withoutRole: new Set<string>([OTHER.address.toLowerCase()]),
    /** The node's hasRole reads fail (an RPC error). */
    hasRoleFails: false,
  };
  const land = (hash: Hex) => {
    const call = state.byHash.get(hash)!;
    const next = state.nonces.get(call.signer.toLowerCase()) ?? 0n;
    if (call.nonce !== next) {
      state.statuses.set(hash, "reverted");
      return;
    }
    state.nonces.set(call.signer.toLowerCase(), next + 1n);
    state.pledges.set(call.pledgeId, {
      initiativeId: call.initiativeId,
      currencyId: call.currencyId,
      amount: call.amount,
    });
    state.statuses.set(hash, "success");
  };
  const revert = (hash: Hex) => state.statuses.set(hash, "reverted");
  const unused = () => Promise.reject(new Error("not used here"));
  const chain = {
    relayerAddress: () => RELAYER,
    relayerNonce: () => Promise.resolve(state.sent.length),
    txStatus: (hash: Hex) =>
      state.txStatusFails
        ? Promise.reject(new Error("rpc down"))
        : Promise.resolve(state.statuses.get(hash) ?? "unknown"),
    codeOf: () => Promise.resolve("0x"),
    blockNumber: () => Promise.resolve(BigInt(state.sent.length + 1)),
    hasRole: (_role: Hex, a: Hex) =>
      state.hasRoleFails
        ? Promise.reject(new Error("rpc down"))
        : Promise.resolve(!state.withoutRole.has(a.toLowerCase())),
    pledgeNonceOf: (a: Hex, block?: bigint) => {
      state.reads.push(["nonce", block]);
      return Promise.resolve(state.nonces.get(a.toLowerCase()) ?? 0n);
    },
    pledgeOf: (id: Hex, block?: bigint) => {
      state.reads.push(["pledge", block]);
      const p = state.pledges.get(id);
      return Promise.resolve(
        p
          ? { ...p, exists: true }
          : { initiativeId: 0n, currencyId: 0n, amount: 0n, exists: false },
      );
    },
    async send(call: Parameters<VoteChain["send"]>[0]) {
      if (call.fn !== "setPledgeBySig") throw new Error(`unexpected ${call.fn}`);
      const [pledgeId, initiativeId, currencyId, amount, signer, nonce, deadline, signature] =
        call.args;
      // The node's gas estimate runs the call: a revert now is a failed send.
      const next = state.nonces.get(signer.toLowerCase()) ?? 0n;
      if (nonce !== next) throw new Error(`InvalidPledgeNonce(${signer}, ${nonce})`);
      if (BigInt(NOW) > deadline) throw new Error("PledgeExpired()");
      const ok = await verifyTypedData({
        address: signer,
        ...pledgeTypedData(m, { pledgeId, initiativeId, currencyId, amount, nonce, deadline }),
        signature,
      });
      if (!ok) throw new Error("InvalidSignature()");
      const hash = `0x${(state.sent.length + 1).toString(16).padStart(64, "0")}` as Hex;
      const sent = { pledgeId, initiativeId, currencyId, amount, signer, nonce, deadline };
      state.sent.push(sent);
      state.byHash.set(hash, sent);
      state.statuses.set(hash, "pending");
      if (state.receipt === "success") land(hash);
      if (state.receipt === "reverted") revert(hash);
      if (state.throwAfterSend) throw new Error("kv write failed");
      return hash;
    },
    ownerOf: unused,
    balanceOf: unused,
    badgeOf: unused,
    idsOf: unused,
    canMint: unused,
    nonceOf: unused,
    balance: unused,
    estimateRecordFor: unused,
    ballots: unused,
    committed: unused,
    rulesHistory: unused,
    asks: unused,
  } as unknown as VoteChain;
  /** The latest transaction sent. */
  const last = () => [...state.byHash.keys()].at(-1)!;
  return { state, chain, land, revert, last };
}

export type Typed = ReturnType<typeof pledgeTypedData>;
/** The prepare answer's typed data, back to bigints, signed by `who`. */
export async function signPrepared(
  body: Record<string, unknown>,
  who = ADMIN_KEY,
): Promise<{ pid: string; nonce: string; deadline: string; signature: Hex; typed: Typed }> {
  const typed = body.typedData as {
    domain: Typed["domain"];
    message: Record<string, string>;
  };
  const message = {
    pledgeId: typed.message.pledgeId as Hex,
    initiativeId: BigInt(typed.message.initiativeId),
    currencyId: BigInt(typed.message.currencyId),
    amount: BigInt(typed.message.amount),
    nonce: BigInt(typed.message.nonce),
    deadline: BigInt(typed.message.deadline),
  };
  const full = { ...(body.typedData as Typed), message };
  const signature = await who.signTypedData(full);
  return {
    pid: body.pid as string,
    nonce: typed.message.nonce,
    deadline: typed.message.deadline,
    signature,
    typed: full,
  };
}
