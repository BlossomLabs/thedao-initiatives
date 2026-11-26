import { voteEnvironment } from "../../shared/vote/environment.ts";
import { DatasetAbort, stageDataset } from "../db/dataset.ts";
import { roundKey } from "../../shared/vote/keys.ts";
import { voteCorrectionRoutes } from "./vote-corrections.ts";
import { parseAffiliations } from "../../shared/affiliations.ts";
import { type Context, Hono } from "hono";
import { voteSettings } from "./board.ts";
import { readVoteSettings } from "../../shared/vote.ts";
import { categoriesOf } from "../../shared/categories.ts";
import { bodyLimit } from "hono/body-limit";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { assertOffBallot, ballotSlot, productionManifest } from "../services/ballot-lock.ts";
import {
  ballotFor,
  dropGoalRequest,
  goalRequestJson,
  requestGoal,
  settleGoalRequest,
  settleOnRead,
} from "../services/goal-requests.ts";
import { auditContext, auditedItem, recordAudit } from "../services/audit.ts";
import { briefFor, rewriteBriefSoon, writeBrief } from "../services/vote-briefs.ts";
import { AiError } from "../services/ai.ts";
import { INITIATIVE_CHANGED } from "../lib/initiative-identity.ts";
import { assertFields, formBody, jsonBody, s } from "../lib/body.ts";
import { assertRecentAuth, requireAdmin, requireRecentAuth } from "../middleware/auth.ts";
import { clearSessionCookie } from "../lib/session-cookie.ts";
import { canReadPrivateFields } from "../lib/private-fields.ts";
import {
  adminCardInitiative,
  adminCommentJson,
  adminInitiative,
  adminPledgeJson,
  cardInitiative,
  donationJson,
  ipfsUrl,
  revisionMeta,
} from "../lib/json.ts";
import { capped, DOMAIN_RE, parseGoal, TX_HASH_RE, validateHttpsLink } from "../lib/validate.ts";
import { decimalsOf } from "./initiatives.ts";
import { LIMITS } from "../../shared/draft/mod.ts";
import { predictSafeAddress, safeDeployCalldata, signersConfigured } from "../chain/safe.ts";
import { isAddress, toChecksum } from "../chain/address.ts";
import { LOGO_NAME_RE, syncContent } from "../services/content.ts";
import { refreshLedger } from "../services/ledger.ts";
import { exportBackup, restoreBackup, validateBackup } from "../services/backup.ts";
import { liveRoles } from "../services/roles.ts";
import { heldContext, rescreen } from "../services/moderation.ts";
import type { AdminEntry } from "../services/admins.ts";
import type { Comment, Initiative, Pledge, PledgeStatus } from "../db/types.ts";
import type { CardRow } from "../db/initiatives.ts";
import { sharedChainState } from "../services/chain-state.ts";
import { CHAIN_ID, LOGO_MAX_BYTES, SAFE_PROXY_FACTORY, SAFE_THRESHOLD } from "../config.ts";
import type { Hex } from "viem";
import { pledgeChainId, pledgeTypedData } from "../../shared/vote/typed-data.ts";
import { newId } from "../lib/ids.ts";
import {
  currentVote,
  roundOf,
  type VoteRoundSetting,
  voteSettingKey,
} from "../services/vote-active.ts";
import { adminBatch } from "../../shared/vote/admin-batch.ts";
import { tierName } from "../../shared/vote/ballot.ts";
import type { VoteRound } from "../services/vote-chain.ts";
import type { VoteReplay } from "./vote.ts";
import { roundStanding } from "../services/round-standing.ts";
import { goalStop } from "../../shared/vote/ballot-facts.ts";
import { readRoundOnChain } from "../services/vote-round-read.ts";
import { errorText, sendNext, withRelayer } from "./vote.ts";
import { TEST_USD_MAX_MINT } from "../../shared/vote/test-usd.ts";
import { parseEther } from "viem";

/** The most Sepolia ETH one admin send gives a tester. */
const MAX_TEST_ETH = 0.1;
import {
  manifestFromChain,
  RoundReadError,
  slugsByAccount,
} from "../../shared/vote/round-from-chain.ts";
import { checkManifest, type VoteManifest } from "../../shared/vote/manifest.ts";
import {
  adminPledges,
  amountAfter,
  PLEDGE_DEADLINE_SECS,
  PLEDGE_ID_RE,
  PLEDGE_REVERTS,
  type PledgeChange,
  pledgeFail,
  type PledgePatch,
  SIGNED_FIELDS,
  signedPledgeOf,
} from "../services/admin-pledges.ts";

import { awaitingPledgesJson, pledgeRequests } from "../services/pledge-requests.ts";
import { PLEDGE_ROLE_ID } from "../../shared/vote/roles.ts";
import { goalBlock, roundAdminQueue } from "../services/round-admin-queue.ts";

export { pledgeOnChain } from "../services/admin-pledges.ts";

/** A pledge's typed data as JSON, for the wallet to sign: the message's numbers as
 * decimal strings. */
const typedDataJson = (typed: ReturnType<typeof pledgeTypedData>) => ({
  ...typed,
  message: Object.fromEntries(Object.entries(typed.message).map(([k, v]) => [k, v.toString()])),
});

export function adminRoutes(deps: Deps, voteReplay: VoteReplay) {
  const r = new Hono<Vars>();
  const { db, config, chain, ens } = deps;
  const pledges = adminPledges(deps);
  const requests = pledgeRequests(deps);
  const queue = roundAdminQueue(deps);
  r.use("*", requireAdmin);
  r.route("/vote-round/corrections", voteCorrectionRoutes(deps, voteReplay));

  r.post("/sessions/revoke", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["address"]);
    const address = s(body.address, 60);
    if (!isAddress(address)) throw new HttpError(400, "that is not an Ethereum address");
    auditContext(c, { target: address });
    const revoked = await db.sessions.revokeAll(address);
    if (address.toLowerCase() === c.var.user!.address.toLowerCase()) {
      c.header("Set-Cookie", clearSessionCookie(c.req.raw));
    }
    return c.json({ ok: true, revoked });
  });

  r.post("/sessions/revoke-all", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["confirmation"]);
    if (body.confirmation !== "revoke all sessions") {
      throw new HttpError(400, "Confirm global revocation with: revoke all sessions");
    }
    await db.sessions.revokeGlobal();
    c.header("Set-Cookie", clearSessionCookie(c.req.raw));
    return c.json({ ok: true });
  });

  /** Admin routes address an initiative by slug (the URL) or by id (older links). */
  const initiativeOr404 = async (idOrSlug: string, mutation = false): Promise<Initiative> => {
    const byId = await db.initiatives.get(idOrSlug);
    if (byId) return byId;
    const initiative = await db.initiatives.bySlug(idOrSlug);
    if (mutation && await db.initiatives.isReusedSlug(idOrSlug)) {
      throw new HttpError(409, INITIATIVE_CHANGED);
    }
    if (!initiative) throw new HttpError(404, "not found");
    return initiative;
  };
  /** Vote-eligibility settings (flag, floor, cap, deadline to qualify): no deploy needed to
   * change them. */
  r.get("/vote-settings", async (c) => c.json(await voteSettings(deps)));
  r.post("/vote-settings", async (c) => {
    const body = await jsonBody(c, ["show", "floorPct", "capUsd", "qualifyBy"]);
    // A body without the deadline (a page from before it) keeps the stored one; null clears it.
    if (!("qualifyBy" in body)) body.qualifyBy = (await voteSettings(deps)).qualifyBy;
    const [v, err] = readVoteSettings(body);
    if (err) throw new HttpError(400, err);
    await db.meta.set("vote_settings", v);
    return c.json(v);
  });

  /** Admin → Vote: the round the site runs, read from its contract (a test round on
   * Sepolia, the real vote on Ethereum), and the pool's ETH while it waits to be sold. */
  const roundSetting = async () =>
    (await db.meta.get<VoteRoundSetting>(voteSettingKey(deps.voteEnvironment ?? "production"))) ??
      {};
  const roundJson = async () => {
    const s = await roundSetting();
    const set = roundOf(s);
    const brief = (m: VoteManifest) => ({
      kind: m.kind,
      chainId: m.chainId,
      contract: m.contract,
      opensAt: m.opensAt,
      closesAt: m.closesAt,
      firstTallyAt: m.schedule.firstTallyAt[0],
      projects: m.slugs.length,
      poolUsd: m.poolUsd,
    });
    return {
      round: set ? { ...brief(set.manifest), at: set.at, by: set.by } : null,
      pool: s.pool ?? null,
    };
  };
  /** While the real vote is open its round is fixed: it can be read again (projects added
   * on-chain), never swapped or taken off the site. */
  /** `next`: the round asked for (its contract and chain, then the manifest read back).
   * Allowed only when it's that same real round: same contract, same chain, still real. */
  const refuseWhileRealOpen = (
    cur: VoteRoundSetting,
    next?: { contract: string; chainId: number; kind?: VoteManifest["kind"] },
  ) => {
    const m = roundOf(cur)?.manifest;
    const now = deps.now();
    if (!(m?.kind === "real" && now >= m.opensAt && now < m.closesAt)) return;
    const same = next !== undefined &&
      m.contract.toLowerCase() === next.contract.toLowerCase() &&
      m.chainId === next.chainId && (next.kind === undefined || next.kind === "real");
    if (!same) {
      throw new HttpError(409, "The real vote is open: its round can't change until it closes.");
    }
  };
  const changedRound = () => deps.voteRound?.forget?.();
  r.get("/vote-round", async (c) => c.json(await roundJson()));
  /** Reads the contract and runs the site on it; again to refresh it after projects or
   * affiliations change on-chain. `chain`: "sepolia" (a test round) or "ethereum". */
  r.post("/vote-round/round", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["contract", "chain"]);
    const contract = s(body.contract, 60).trim();
    if (!isAddress(contract)) throw new HttpError(400, "The contract isn't an address.");
    const chain = body.chain === "ethereum"
      ? "ethereum"
      : body.chain === "sepolia"
      ? "sepolia"
      : null;
    if (!chain) throw new HttpError(400, "chain is sepolia or ethereum");
    if (chain !== (deps.voteEnvironment === "test" ? "sepolia" : "ethereum")) {
      throw new HttpError(400, "The network does not match this vote environment.");
    }
    const chainName = chain === "ethereum" ? "Ethereum" : "Sepolia";
    const rpc = chain === "ethereum" ? deps.config.rpcEndpoints[0] : deps.config.sepoliaRpcUrl;
    if (!rpc) throw new HttpError(503, `No ${chainName} RPC is configured.`);
    const chainId = chain === "ethereum" ? 1 : 11155111;
    refuseWhileRealOpen(await roundSetting(), { contract, chainId });
    const rows = await db.initiatives.list(["approved", "archived", "pending", "rejected"]);
    let manifest: VoteManifest;
    const warnings: string[] = [];
    try {
      const read = await readRoundOnChain(
        contract as Hex,
        rpc,
        undefined,
        chainId,
      );
      manifest = checkManifest(
        manifestFromChain(
          contract as Hex,
          read,
          slugsByAccount(rows),
          roundOf(await roundSetting())?.manifest,
        ),
      );
      const relayer = (await currentVote(deps))?.chain.relayerAddress();
      if (!relayer) warnings.push("No relayer key is configured: ballots can't be relayed.");
      else if (manifest.kind === "test" && !(await read.minters(relayer))) {
        warnings.push(
          `The relayer ${relayer} can't mint badges on this contract: no badges can be given.`,
        );
      }
    } catch (e) {
      if (e instanceof RoundReadError) throw new HttpError(400, e.message);
      // RPC errors can carry the node's URL (and its key): logged, never shown.
      deps.log(`vote round read ${contract}: ${e instanceof Error ? e.message : String(e)}`);
      throw new HttpError(502, `Couldn't read the round from ${chainName}. Try again.`);
    }
    if (voteEnvironment(manifest) !== (deps.voteEnvironment ?? "production")) {
      throw new HttpError(400, "The round does not match this vote environment.");
    }
    await db.meta.update<VoteRoundSetting>(
      voteSettingKey(deps.voteEnvironment ?? "production"),
      (cur) => {
        refuseWhileRealOpen(cur ?? {}, {
          contract: manifest.contract,
          chainId: manifest.chainId,
          kind: manifest.kind,
        });
        const { test: _, ...rest } = cur ?? {};
        return { ...rest, round: { manifest, at: deps.now(), by: c.var.user!.address } };
      },
    );
    changedRound();
    return c.json({ ...(await roundJson()), warnings });
  });
  /** No round on the site: the vote pages say there's none. */
  r.delete("/vote-round/round", requireRecentAuth(deps.now), async (c) => {
    await jsonBody(c, []);
    await db.meta.update<VoteRoundSetting>(
      voteSettingKey(deps.voteEnvironment ?? "production"),
      (cur) => {
        refuseWhileRealOpen(cur ?? {});
        const { test: _, round: __, ...rest } = cur ?? {};
        return rest;
      },
    );
    changedRound();
    return c.json(await roundJson());
  });
  /** The pool's ETH (null: say nothing) and whether it's been sold for USD yet. */
  r.post("/vote-round/pool", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["eth", "sold"]);
    const eth = body.eth === null ? null : Number(body.eth);
    if (eth !== null && !(Number.isFinite(eth) && eth > 0 && eth < 1e7)) {
      throw new HttpError(400, "The ETH amount isn't a number.");
    }
    if (typeof body.sold !== "boolean") throw new HttpError(400, "sold must be true or false");
    await db.meta.update<VoteRoundSetting>(
      voteSettingKey(deps.voteEnvironment ?? "production"),
      (cur) => {
        const { pool: _, ...rest } = cur ?? {};
        return eth === null ? rest : { ...rest, pool: { eth, sold: body.sold as boolean } };
      },
    );
    changedRound();
    return c.json(await roundJson());
  });

  /**
   * The pool's dollars on the contract (#103): its last PoolUsdSet (the deploy's figure
   * before any is read), the live ETH price for the card's estimate (null when the feed
   * can't be read), and the contract's dates: lowering it is allowed only before S-Tier's
   * first tally (`lowerUntil`), and nothing changes once voting closes.
   */
  const poolOnChain = async (d: VoteRound): Promise<bigint> => {
    try {
      const last = (await d.chain.rulesHistory()).pool.at(-1);
      return last ? last.poolUsd : BigInt(d.manifest.poolUsd);
    } catch (e) {
      deps.log(`vote pool read: ${e instanceof Error ? e.message : String(e)}`);
      throw new HttpError(502, "Couldn't read the pool from the contract. Try again.");
    }
  };
  const dollars = (micro: bigint) =>
    `$${
      (Number(micro) / 1e6).toLocaleString("en-US", {
        minimumFractionDigits: micro % 1_000_000n ? 2 : 0,
        maximumFractionDigits: 2,
      })
    }`;
  r.get("/vote-round/pool-usd", async (c) => {
    const d = await roundNow();
    const [poolUsd, ethUsd] = await Promise.all([
      poolOnChain(d),
      deps.chain.usdRate("ETH").catch(() => null),
    ]);
    return c.json({
      poolUsd: String(poolUsd),
      ethUsd,
      lowerUntil: d.manifest.schedule.firstTallyAt[0],
      closesAt: d.manifest.closesAt,
    });
  });
  /** Set the pool's dollars on-chain: the Transaction Builder batch for the round's admin
   * (setPoolUsd needs ADMIN_ROLE; the site never sends it). Refused when it holds that
   * already, when it would go down after S-Tier's first tally, and after the close. */
  r.post("/vote-round/pool-usd", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["usd"]);
    const usd = typeof body.usd === "number" ? body.usd : Number.NaN;
    if (!(Number.isFinite(usd) && usd >= 0 && usd < 1e10)) {
      throw new HttpError(400, "The pool's dollars aren't a number.");
    }
    const micro = BigInt(Math.round(usd * 100)) * 10_000n; // whole cents
    auditContext(c, { detail: dollars(micro) });
    const d = await roundNow();
    if (deps.now() >= d.manifest.closesAt) {
      throw new HttpError(409, "Voting has closed; the pool can't change now.");
    }
    const cur = await poolOnChain(d);
    if (micro === cur) throw new HttpError(409, `The contract already holds ${dollars(cur)}.`);
    if (micro < cur && deps.now() >= d.manifest.schedule.firstTallyAt[0]) {
      throw new HttpError(
        409,
        `${tierName("S")}'s first tally has passed: the pool can only go up now ` +
          `(the contract holds ${dollars(cur)}).`,
      );
    }
    return c.json(
      adminBatch(d.manifest, `Set the vote's pool to ${dollars(micro)}`, [{
        fn: "setPoolUsd",
        args: [micro],
      }]),
    );
  });

  /**
   * Each initiative of the round now: withdrawn at the replay's head, and the tier it is
   * settled in (funded or covered at a settlement), which closes the withdrawal. Read from
   * the public round (its few-second cache), so it agrees with what voters see.
   */
  const withdrawals = (d: VoteRound) => roundStanding(d, voteReplay);
  /** Whether the round's contract has withdrawals at all (the first test round doesn't). */
  const canWithdraw = (d: VoteRound) => d.chain.canWithdraw?.() ?? Promise.resolve(true);
  const roundNow = async () => {
    const d = await currentVote(deps);
    if (!d) throw new HttpError(503, "No vote is deployed right now.");
    return d;
  };
  r.get("/vote-round/initiatives", async (c) => {
    const d = await roundNow();
    const [list, can] = await Promise.all([withdrawals(d), canWithdraw(d)]);
    return c.json({ ...list, canWithdraw: can });
  });
  /**
   * Withdraw an initiative from the vote, or undo it: the Safe Transaction Builder batch
   * for the round's admin (the site never sends it). Refused once the project is settled
   * in a tier, when it is already in the requested state at the replay's head, once every
   * tier has settled (the tally is final), after the vote closes, and for a contract from
   * before withdrawals (the contract refuses the state and the close; the replay ignores a
   * withdrawal of a settled project).
   */
  r.post("/vote-round/withdraw", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["slug", "withdrawn"]);
    const slug = s(body.slug, 200);
    if (typeof body.withdrawn !== "boolean") {
      throw new HttpError(400, "withdrawn must be true or false");
    }
    const d = await roundNow();
    const i = d.manifest.slugs.indexOf(slug);
    if (i < 0) throw new HttpError(404, "That initiative isn't in the vote.");
    auditContext(c, { target: slug });
    if (deps.now() >= d.manifest.closesAt) {
      throw new HttpError(409, "Voting has closed; nothing can be withdrawn now.");
    }
    if (!await canWithdraw(d)) {
      throw new HttpError(409, "This round's contract predates withdrawals.");
    }
    const list = await withdrawals(d);
    if (list.final) {
      throw new HttpError(
        409,
        "Every tier has settled: the vote's tally is final, nothing to withdraw from.",
      );
    }
    const st = list.initiatives[i];
    if (st.settledIn) {
      throw new HttpError(
        409,
        `This initiative is settled in ${tierName(st.settledIn)}; it can't be withdrawn.`,
      );
    }
    if (st.withdrawn === body.withdrawn) {
      throw new HttpError(
        409,
        body.withdrawn
          ? "This initiative is already withdrawn."
          : "This initiative isn't withdrawn.",
      );
    }
    return c.json(
      adminBatch(
        d.manifest,
        body.withdrawn ? `Withdraw ${slug} from the vote` : `Undo the withdrawal of ${slug}`,
        [{
          fn: body.withdrawn ? "withdrawInitiative" : "undoWithdrawInitiative",
          args: [BigInt(i)],
        }],
      ),
    );
  });

  /** A test round's helpers for people joining it (badges, Sepolia ETH, TestUSD), sent
   * by the relayer. Never in the real vote. */
  const testRoundNow = async () => {
    const d = await currentVote(deps);
    if (!d) throw new HttpError(503, "No vote is deployed right now.");
    if (d.manifest.kind !== "test") throw new HttpError(409, "Only a test round gives these.");
    if (!d.chain.relayerAddress()) throw new HttpError(503, "No relayer key is configured.");
    return d;
  };
  const addressIn = (v: unknown) => {
    const a = s(v, 60).trim();
    if (!isAddress(a)) throw new HttpError(400, "That isn't an address.");
    return toChecksum(a) as Hex;
  };
  /** A test badge, minted to the address: its ballot is at /vote/ballot once it signs in. */
  r.post("/vote-round/badge", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["address"]);
    const to = addressIn(body.address);
    const d = await testRoundNow();
    if (deps.now() >= d.manifest.closesAt) throw new HttpError(410, "Voting has closed.");
    // An EIP-7702 account (code 0xef0100 + delegate) still signs with its key; other code
    // is a contract wallet, which can't sign the ballot the way record() checks.
    const code = (await d.chain.codeOf(to)).toLowerCase();
    const delegated = code.startsWith("0xef0100") && code.length === 2 + 2 * 23;
    if (code !== "0x" && !delegated) {
      throw new HttpError(422, "That's a contract wallet: it can't sign ballots here.");
    }
    const kv = db.kv;
    const nextKey = [...roundKey(d.manifest), "admin-badge-next"];
    const sent = await withRelayer(kv, d, async () => {
      if ((await d.chain.balanceOf(to)) > 0n) {
        throw new HttpError(409, "That address already has a badge.");
      }
      // The next id nobody holds (vote-sim mints far above these).
      let n = BigInt((await kv.get<number>(nextKey)).value ?? 1);
      while ((await d.chain.ownerOf(n)) !== null) n++;
      if (delegated && !(await d.chain.canMint(to, n))) {
        throw new HttpError(422, "That wallet can't receive the badge.");
      }
      const hash = await sendNext(kv, d, deps.now(), { fn: "mint", args: [to, n] });
      await kv.set(nextKey, Number(n) + 1);
      return { hash, tokenId: Number(n) };
    });
    return c.json(sent);
  });
  /** Sepolia ETH from the relayer, so a tester can send their own ballot or donate. */
  r.post("/vote-round/eth", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["address", "eth"]);
    const to = addressIn(body.address);
    const eth = Number(body.eth);
    if (!(Number.isFinite(eth) && eth > 0 && eth <= MAX_TEST_ETH)) {
      throw new HttpError(400, `Send more than 0 and at most ${MAX_TEST_ETH} ETH.`);
    }
    const d = await testRoundNow();
    const value = parseEther(String(eth));
    const hash = await withRelayer(db.kv, d, async () => {
      const left = await d.chain.balance(d.chain.relayerAddress()!);
      if (left < value) throw new HttpError(409, "The relayer doesn't have that much ETH.");
      return await sendNext(db.kv, d, deps.now(), { fn: "drip", to, value });
    });
    return c.json({ hash });
  });
  /** Test dollars to donate with (the round's TestUSD, worth nothing). */
  r.post("/vote-round/test-usd", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["address", "usd"]);
    const to = addressIn(body.address);
    const usd = Number(body.usd);
    if (!(Number.isInteger(usd) && usd > 0 && usd <= TEST_USD_MAX_MINT)) {
      throw new HttpError(
        400,
        `Mint whole test dollars, up to ${TEST_USD_MAX_MINT.toLocaleString("en-US")}.`,
      );
    }
    const d = await testRoundNow();
    const token = d.manifest.currencies?.find((x) => x.symbol === "tUSD")?.asset;
    if (!token) throw new HttpError(409, "This round has no TestUSD.");
    const hash = await withRelayer(
      db.kv,
      d,
      () =>
        sendNext(db.kv, d, deps.now(), {
          fn: "testUsd",
          token,
          to,
          amount: BigInt(usd) * 1_000_000n,
        }),
    );
    return c.json({ hash });
  });

  /**
   * Admin → Vote "Test pledge": a pledge in the test round only, on Sepolia, to one of its
   * initiatives. It lowers that initiative's ask in the test vote and is never one of the
   * site's pledge records. The pledge form's own steps: the write is a 428 until signed,
   * `prepare` gives the typed data, the signed write is relayed (setPledgeBySig, 202 with
   * the hash), and `settle` says once it landed. The signer needs the round's PLEDGE_ROLE
   * (sem-the-bee.eth has it from the deploy).
   */
  const testPledgeTarget = async (slug: string) => {
    const d = await testRoundNow();
    if (deps.now() >= d.manifest.closesAt) throw new HttpError(410, "Voting has closed.");
    const initiativeId = d.manifest.slugs.indexOf(slug);
    if (initiativeId < 0) throw new HttpError(404, "That initiative isn't in the test round.");
    return { d, initiativeId };
  };
  /** The form's body (multipart, its logo ignored; or JSON): the amount in micro-USD. */
  const testPledgeBody = async (c: Context<Vars>) => {
    const allowed = ["company", "amount", "url", "note", "status", ...SIGNED_FIELDS, "remove"];
    const fields: Record<string, unknown> = {};
    if ((c.req.header("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await formBody(c, [...allowed, "logo"]);
      for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
    } else Object.assign(fields, await jsonBody(c, allowed));
    if (fields.status !== undefined && fields.status !== "pledged") {
      throw new HttpError(400, "A test pledge is an open pledge: choose “pledged”.");
    }
    const [usd, err] = parseGoal(fields.amount);
    if (err) throw new HttpError(400, err);
    return { fields, amount: BigInt(Math.round(usd! * 1e6)) };
  };
  r.post("/vote-round/test-pledges/:slug/pledges/prepare", async (c) => {
    const { d, initiativeId } = await testPledgeTarget(c.req.param("slug"));
    const { fields, amount } = await testPledgeBody(c);
    if (
      fields.pid !== undefined && (typeof fields.pid !== "string" || !PLEDGE_ID_RE.test(fields.pid))
    ) {
      throw new HttpError(400, "bad pledge id");
    }
    const pid = (fields.pid as string | undefined) ?? `test-${newId()}`;
    const typed = pledgeTypedData(d.manifest, {
      pledgeId: pledgeChainId(pid),
      initiativeId: BigInt(initiativeId),
      currencyId: 0n,
      amount,
      nonce: await d.chain.pledgeNonceOf(c.var.user!.address as Hex),
      deadline: BigInt(Math.floor(deps.now()) + PLEDGE_DEADLINE_SECS),
    });
    return c.json({
      pid,
      typedData: typedDataJson(typed),
    });
  });
  /** Relay a test pledge (setPledgeBySig on the test round's contract): 202 with the hash.
   * Never one of the site's pledge records. */
  const relayTestPledge = async (
    c: Context<Vars>,
    d: VoteRound,
    initiativeId: number,
    amount: bigint,
    signed: ReturnType<typeof signedPledgeOf>,
  ) => {
    try {
      const hash = await withRelayer(db.kv, d, () =>
        sendNext(db.kv, d, deps.now(), {
          fn: "setPledgeBySig",
          args: [
            pledgeChainId(signed.pid),
            BigInt(initiativeId),
            0n,
            amount,
            c.var.user!.address as Hex,
            signed.nonce,
            signed.deadline,
            signed.signature as Hex,
          ],
        }));
      return c.json({ hash, pid: signed.pid }, 202);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const revert = PLEDGE_REVERTS.find(([re]) => re.test(String(e)));
      deps.log(`test pledge: setPledgeBySig refused (${errorText(e)})`);
      throw pledgeFail(
        502,
        "pledge_not_recorded",
        `The test pledge wasn't recorded: ${revert?.[1] ?? "the chain refused it"}.`,
      );
    }
  };
  r.post("/vote-round/test-pledges/:slug/pledges", async (c) => {
    const { d, initiativeId } = await testPledgeTarget(c.req.param("slug"));
    const { fields, amount } = await testPledgeBody(c);
    return await relayTestPledge(c, d, initiativeId, amount, signedPledgeOf(fields));
  });
  r.post("/vote-round/test-pledges/:slug/pledges/:pid/settle", async (c) => {
    const { d } = await testPledgeTarget(c.req.param("slug"));
    const hash = s((await jsonBody(c, ["hash"])).hash, 80);
    if (!TX_HASH_RE.test(hash)) return c.json({ state: "pending" });
    const status = await d.chain.txStatus(hash as Hex).catch(() => "unknown" as const);
    return c.json({
      state: status === "success" ? "saved" : status === "reverted" ? "failed" : "pending",
    });
  });

  /**
   * Waiting for a round admin (services/round-admin-queue.ts): initiatives Ready for the
   * ballot and Pledges to sign, for the round this path serves (/vote-test-round: the test
   * round's). Signing an item runs the pledge form's steps: `prepare` gives the typed data
   * for the item's change, the signed send relays it (202 `{ hash, pid }`, or 200 when the
   * chain already held it), and the form settles it with the usual route: the initiative's
   * `/pledges/:pid/settle` on the real round, `/vote-round/test-pledges/:slug/pledges/:pid/
   * settle` on a test round (where nothing touches the site's rows).
   */
  r.get("/vote-round/queue", async (c) => {
    const d = await roundNow();
    const q = await queue.queue(d);
    if (!q.goals.length) return c.json(q);
    // A goal change of a settled or withdrawn initiative, or while a tier settles, waits
    // (#149). If the round's state can't be read, every Sign waits: never signed blind.
    const standing = deps.ballotStanding && d.manifest.kind === "real"
      ? await deps.ballotStanding().catch(() => null)
      : (await withdrawals(d).catch(() => null))?.initiatives ?? null;
    return c.json({
      ...q,
      goals: q.goals
        .map((g) => ({
          ...g,
          blocked: goalBlock(Number(g.call.id), standing, d.manifest.schedule, deps.now()),
        }))
        // A difference that can never be signed (settled or withdrawn) has nothing to do.
        .filter((g) =>
          !(g.kind === "record" &&
            (g.blocked?.kind === "settled" || g.blocked?.kind === "withdrawn"))
        ),
    });
  });
  /** Put on the ballot, one round admin at a time (services/round-admin-queue.ts): the
   * browser claims the initiative before its run and releases it after, whatever the
   * outcome. A claim lapses after five minutes. */
  r.post("/vote-round/ballot-claims/:rfpId", async (c) => {
    await jsonBody(c, []);
    const d = await roundNow();
    return c.json(await queue.claim(d, c.req.param("rfpId"), c.var.user!.address));
  });
  r.delete("/vote-round/ballot-claims/:rfpId", async (c) => {
    const d = await roundNow();
    await queue.release(d, c.req.param("rfpId"), c.var.user!.address);
    return c.json({ ok: true });
  });
  r.post("/vote-round/queue/:rfpId/:pid/prepare", async (c) => {
    await jsonBody(c, []);
    const d = await roundNow();
    const pid = c.req.param("pid");
    const { initiativeId, row, change } = await queue.target(d, c.req.param("rfpId"), pid);
    const typed = pledgeTypedData(d.manifest, {
      pledgeId: pledgeChainId(pid),
      initiativeId: BigInt(initiativeId),
      currencyId: 0n,
      amount: amountAfter(change, row),
      nonce: await d.chain.pledgeNonceOf(c.var.user!.address as Hex),
      deadline: BigInt(Math.floor(deps.now()) + PLEDGE_DEADLINE_SECS),
    });
    return c.json({ pid, typedData: typedDataJson(typed) });
  });
  r.post("/vote-round/queue/:rfpId/:pid", async (c) => {
    const body = await jsonBody(c, SIGNED_FIELDS);
    const d = await roundNow();
    const pid = c.req.param("pid");
    const rfpId = c.req.param("rfpId");
    if (deps.now() >= d.manifest.closesAt) throw new HttpError(410, "Voting has closed.");
    const signed = signedPledgeOf(body);
    if (signed.pid !== pid) throw new HttpError(400, "bad pledge id");
    const { initiativeId, row, change } = await queue.target(d, rfpId, pid, true);
    if (d.manifest.kind === "test") {
      return await relayTestPledge(c, d, initiativeId, amountAfter(change, row), signed);
    }
    const r = await pledges.write({
      d,
      initiativeId,
      rfpId,
      admin: c.var.user!.address as Hex,
      signed,
      change,
    });
    if (r.pending) return c.json(sent(r), 202);
    return c.json({ ok: true, pledge: r.pledge && adminPledgeJson(config, r.pledge) });
  });

  /**
   * The dashboard's first paint (#89): what is waiting for an admin, from the
   * status index and one pass over the comments. No funding, chain or Safe
   * calls, so it answers in one KV wave however many initiatives there are.
   */
  r.get("/todo", async (c) => {
    const [pending, approved, rejected, archived, queues, admins] = await Promise.all([
      db.initiatives.cards("pending"),
      db.initiatives.cards("approved"),
      db.initiatives.cards("rejected"),
      db.initiatives.cards("archived"),
      db.comments.queues(),
      deps.admins.set(),
    ]);
    const all = [...pending, ...approved, ...rejected, ...archived];
    const byId = new Map(all.map((x) => [x.id, x]));
    // The admin tables show no role tags, so neither the proposer nor the badge is looked up.
    const comment = (cm: Comment) =>
      adminCommentJson(cm, liveRoles(admins, cm.address, null, false), byId.get(cm.rfpId));
    const todoRow = (x: CardRow) => ({
      ...cardInitiative(x),
      pendingRevision: x.pendingRevision ?? null,
    });
    const weekAgo = deps.now() - 7 * 86400;
    return c.json({
      // Oldest first: the one that has waited longest is the next to review.
      submissions: [...pending].reverse().map(todoRow),
      edits: approved.filter((x) => x.pendingRevision).map(todoRow),
      held: queues.held.map(comment),
      unanswered: queues.unanswered.map(comment),
      reported: queues.reported.map(comment),
      weekAgo,
      // For the "Open an initiative" search: every row, newest first within each status.
      index: all.map((x) => ({
        id: x.id,
        slug: x.slug,
        title: x.title,
        status: x.status,
        type: x.type,
      })),
      counts: {
        total: all.length,
        approved: approved.length,
        approvedThisWeek: approved.filter((x) => (x.approvedAt ?? 0) >= weekAgo).length,
      },
    });
  });

  /** The services an admin checks now and then: snapshots only, never a chain call. */
  r.get("/status", async (c) => {
    const [state, quota] = await Promise.all([
      sharedChainState(deps, false),
      db.meta.get("safe_api_quota"),
    ]);
    const [signersOk, signersDetail] = signersConfigured(config.operationalSigners);
    return c.json({
      chain: { detail: state.detail, checkedAt: state.checkedAt },
      safeApi: {
        configured: Boolean(config.safeApiKey),
        quota,
        refreshMinutes: config.safeSyncTtlSecs / 60,
      },
      signers: {
        ok: signersOk,
        detail: signersDetail,
        list: config.operationalSigners,
        threshold: SAFE_THRESHOLD,
      },
    });
  });

  /**
   * The held comments with what an admin needs to publish or discard them
   * (#88): the parent of a reply and what the board knows about the author.
   * Its own request: the author facts read every initiative and ask the chain
   * for badges, which the to-do list's first paint must not wait for.
   */
  r.get("/held", async (c) => {
    const [{ held }, initiatives, admins] = await Promise.all([
      db.comments.queues(),
      db.initiatives.list(["pending", "approved", "rejected", "archived"]),
      deps.admins.set(),
    ]);
    const byId = new Map(initiatives.map((x) => [x.id, x]));
    const context = await heldContext(deps, held, initiatives);
    return c.json({
      held: held.map((cm) => ({
        ...adminCommentJson(cm, liveRoles(admins, cm.address, null, false), byId.get(cm.rfpId)),
        context: context.get(cm.id) ?? { parent: null, author: null },
      })),
    });
  });

  /**
   * Every initiative for the dashboard's full table, its own request so the
   * to-do list never waits for it. Funding comes from the card summaries and the Safe balance
   * snapshots, never a refresh: the table is a list, the initiative page is
   * where a balance is refreshed.
   */
  r.get("/initiatives", async (c) => {
    const rows = await db.initiatives.list(["pending", "approved", "rejected", "archived"]);
    const rank = { pending: 0, approved: 1, rejected: 2, archived: 2 } as const;
    rows.sort((a, b) => rank[a.status] - rank[b.status]);
    const ids = rows.map((x) => x.id);
    const [summaries, syncs] = await Promise.all([
      db.cards.summaries(ids),
      db.meta.safeSyncs(ids),
    ]);
    const now = deps.now();
    return c.json({
      rows: await Promise.all(rows.map(async (initiative, i) => {
        const s = summaries[i];
        const sumOf = (status: Pledge["status"]) =>
          s.pledges.filter((p) => p.status === status).reduce((n, p) => n + p.amountUsd, 0);
        return {
          initiative: adminCardInitiative(
            initiative,
            canReadPrivateFields(initiative, c.var.user, now),
          ),
          summary: await deps.funding.summaryOf(initiative, {
            pledged: sumOf("pledged"),
            received: sumOf("received"),
            ledger: s.donatedUsd,
          }),
          safeSync: initiative.safeAddress ? syncs[i] : null,
        };
      })),
    });
  });

  // Maintenance mode: pause every write on the site (services/maintenance.ts).
  r.get("/maintenance", async (c) => c.json(await deps.maintenance.fresh()));
  r.post("/maintenance/enter", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["note"]);
    return c.json(await deps.maintenance.enter(c.var.user!.address, s(body.note, 200)));
  });
  r.post("/maintenance/exit", requireRecentAuth(deps.now), async (c) => {
    await jsonBody(c, []);
    return c.json(await deps.maintenance.exit(c.var.user!.address));
  });

  // Today's AI calls against the daily caps, and a way to give them back.
  r.get("/ai-budget", async (c) => c.json(await db.meta.aiBudgetToday()));
  r.post("/ai-budget/reset", requireRecentAuth(deps.now), async (c) => {
    await jsonBody(c, []);
    return c.json(await db.meta.aiBudgetReset());
  });

  // The whole database as one file, and the way back (services/backup.ts).
  r.get("/backup", requireRecentAuth(deps.now), async (c) => {
    const backup = await exportBackup(db, deps.now);
    const stamp = backup.exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    return c.body(JSON.stringify(backup), 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="thedao-kv-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    });
  });
  r.post(
    "/restore",
    requireRecentAuth(deps.now),
    bodyLimit({
      maxSize: 32 * 1024 * 1024,
      onError: (c) => c.json({ error: "Backup file too large (32 MB max)." }, 413),
    }),
    async (c) => {
      const body = await jsonBody(c, ["mode", "backup"]);
      const mode = body.mode ?? "merge";
      if (mode !== "merge" && mode !== "replace") {
        throw new HttpError(400, "mode must be merge or replace");
      }
      if (!(await deps.maintenance.fresh()).on) {
        throw new HttpError(409, "Turn maintenance mode on before restoring a backup.");
      }
      const backup = validateBackup(body.backup);
      auditContext(c, { detail: mode });
      const result = await restoreBackup(db, backup, mode, deps.now);
      deps.log(
        `backup restore (${mode}): written=${result.written} skipped=${result.skipped} claims=${result.claimsRebuilt}`,
      );
      return c.json(result);
    },
  );

  // The admin list. ADMIN_ADDRESSES entries are fixed; the rest live in KV.
  const adminsJson = (admins: AdminEntry[], c: Context<Vars>) =>
    c.json({ admins, you: c.var.user!.address });
  r.get("/admins", async (c) => adminsJson(await deps.admins.list(), c));
  r.post("/admins", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["address"]);
    const address = s(body.address, 60);
    auditContext(c, { target: address });
    const admins = await deps.admins.add(address);
    recordAudit(deps, c, {
      action: "session.admin_revoke",
      targetKind: "wallet",
      target: address,
      outcome: "success",
    });
    return adminsJson(admins, c);
  });
  r.delete("/admins/:address", requireRecentAuth(deps.now), async (c) => {
    await jsonBody(c, []);
    const address = c.req.param("address");
    const admins = await deps.admins.remove(address, c.var.user!.address);
    recordAudit(deps, c, {
      action: "session.admin_revoke",
      targetKind: "wallet",
      target: address,
      outcome: "success",
    });
    return adminsJson(admins, c);
  });

  r.get("/initiatives/:id", async (c) => {
    const found = await initiativeOr404(c.req.param("id"));
    // A goal the round has now: the page takes it (#149).
    const round = await ballotFor(db, found);
    const settled = await settleOnRead(
      db,
      () => deps.maintenance.on(),
      round.manifest,
      found,
      round.goalRequest,
    );
    const initiative = settled.row;
    const [signersOk, signersDetail] = signersConfigured(config.operationalSigners);
    // Pledge changes that landed on-chain since are applied before the list is read.
    const pendingPledges = await pledges.settleAll(initiative.id);
    const pledgeRows = await db.pledges.list(initiative.id, true);
    // Awaiting signature: only the real round holds requests.
    const vote = await currentVote(deps);
    const awaitingPledges = vote?.manifest.kind === "real"
      ? awaitingPledgesJson(await requests.list(vote, initiative.id), pledgeRows)
      : [];
    // Once the vote has closed they can't be signed: saved as they are, or discarded.
    const awaitingClosed = awaitingPledges.length > 0 && !(await pledges.onChainFor(initiative));
    return c.json({
      initiative: adminInitiative(
        initiative,
        canReadPrivateFields(initiative, c.var.user, deps.now()),
      ),
      revisions: (await db.revisions.list(initiative.id, true, true)).map(revisionMeta),
      summary: await deps.funding.summary(initiative, !(await deps.maintenance.on())),
      pledges: pledgeRows.map((p) => adminPledgeJson(config, p)),
      pendingPledges,
      awaitingPledges,
      awaitingClosed,
      onBallot: round.slot >= 0,
      goalRequest: goalRequestJson(settled.request),
      donations: (await db.donations.list(initiative.id, false)).map((d) =>
        donationJson(d, decimalsOf)
      ),
      safeSync: initiative.safeAddress ? await db.meta.safeSync(initiative.id) : null,
      signers: {
        ok: signersOk,
        detail: signersDetail,
        list: config.operationalSigners,
        threshold: SAFE_THRESHOLD,
      },
    });
  });

  /**
   * The admin settings of an initiative: board pin, owner and paid out. The
   * text, the categories and the page facts are edited through the routes a
   * proposer uses.
   */
  r.patch("/initiatives/:id", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const body = await jsonBody(c, ["sortRank", "paidOutUsd", "proposer", "affiliations"]);
    if (body.paidOutUsd !== undefined || body.proposer !== undefined) assertRecentAuth(c, deps.now);
    const patch: Partial<Initiative> = {};
    if (body.sortRank !== undefined) {
      const raw = s(body.sortRank, 10);
      if (!raw) patch.sortRank = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n)) {
          throw new HttpError(400, "Pin position must be a number (1-999).");
        }
        patch.sortRank = Math.max(1, Math.min(999, n));
      }
    }
    // Money already paid to the team, so "raised" (balance + paid out) never goes backwards.
    if (body.paidOutUsd !== undefined) {
      const raw = s(body.paidOutUsd, 20).replace(/[,$\s]/g, "");
      const n = raw ? Number(raw) : 0;
      if (!Number.isFinite(n) || n < 0) {
        throw new HttpError(400, "Paid out must be a USD amount of zero or more.");
      }
      patch.paidOutUsd = Math.round(n * 100) / 100;
    }
    // Owner: the wallet shown publicly as "Proposed by". Address or ENS name; blank clears.
    if (body.proposer !== undefined) {
      const raw = s(body.proposer, 100);
      const lower = raw.toLowerCase();
      if (!raw) patch.proposer = "";
      else if (isAddress(raw)) patch.proposer = toChecksum(raw);
      else if (DOMAIN_RE.test(lower)) {
        const resolved = await ens.forward(raw);
        if (!resolved) throw new HttpError(400, `${raw} does not resolve to an address.`);
        patch.proposer = resolved;
      } else throw new HttpError(400, "Owner must be a wallet address or an ENS name.");
    }
    // Affiliations: related projects share one (the ballot rules). Never on an RFP.
    if (body.affiliations !== undefined) {
      let affiliations: string[];
      try {
        affiliations = parseAffiliations(s(body.affiliations, 400));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      if (affiliations.length && initiative.type === "rfp") {
        throw new HttpError(400, "RFPs can't have affiliations.");
      }
      // On the ballot the affiliations change only with the round (#149): the same list,
      // in any case or order, is no change. Off the ballot it saves as sent.
      const key = (xs: string[]) => xs.map((x) => x.toLowerCase()).sort().join("\n");
      const changed = key(affiliations) !== key(initiative.affiliations ?? []);
      const onBallot = ballotSlot(await productionManifest(db), initiative) >= 0;
      assertOffBallot(onBallot, changed);
      if (changed || !onBallot) patch.affiliations = affiliations;
    }
    const next = Object.keys(patch).length
      ? await db.initiatives.update(initiative.id, patch)
      : initiative;
    return c.json({
      initiative: adminInitiative(next, canReadPrivateFields(next, c.var.user, deps.now())),
    });
  });

  /** Hide a superseded revision from the public history, or show it again. */
  r.post("/initiatives/:id/revisions/:n", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const n = Number(c.req.param("n"));
    const action = s((await jsonBody(c, ["action"])).action, 20);
    auditContext(c, { target: `${initiative.id}:${n}`, detail: action });
    if (action !== "archive" && action !== "unarchive") throw new HttpError(400, "bad action");
    if (action === "archive" && n === initiative.revision) {
      throw new HttpError(
        400,
        "The current revision cannot be archived; save a new revision to replace it.",
      );
    }
    const rev = Number.isInteger(n) && n > 0
      ? await db.revisions.setArchived(initiative.id, n, action === "archive")
      : null;
    if (!rev) throw new HttpError(404, "not found");
    return c.json({ revision: revisionMeta(rev) });
  });

  /**
   * Decide the proposer's edit waiting on an approved initiative: accept
   * publishes it, reject (with an optional note for the proposer) leaves the
   * live text alone. 409 when `n` is not the edit waiting.
   */
  for (const verdict of ["accept", "reject"] as const) {
    r.post(`/initiatives/:id/revisions/:n/${verdict}`, requireRecentAuth(deps.now), async (c) => {
      const initiative = await initiativeOr404(c.req.param("id"), true);
      const n = Number(c.req.param("n"));
      const note = s((await jsonBody(c, ["note"])).note, 500);
      auditContext(c, { target: `${initiative.id}:${n}`, detail: verdict });
      // On the ballot (#149) accepting puts the text live and leaves the goal it carries
      // waiting for a round admin to sign. Once the vote has closed the round's goal is
      // final: the text still goes live, the goal is dropped.
      const round = await ballotFor(db, initiative);
      const keepGoal = verdict === "accept" && round.slot >= 0;
      const closed = !!round.manifest && deps.now() >= round.manifest.closesAt;
      // Settled or withdrawn: the same, the goal can't change any more.
      const stopped = keepGoal && !closed &&
        goalStop(await deps.ballotStanding?.() ?? null, round.slot) !== null;
      const goal = keepGoal && !closed && !stopped && Number.isInteger(n) && n > 0
        ? (await db.revisions.get(initiative.id, n))?.goalUsd
        : undefined;
      // The request is saved before the text goes live: if saving it fails, the edit is still
      // waiting and can be accepted again; if accepting fails, the request goes. A goal the
      // page already has asks for nothing (and keeps another waiting request).
      const asked = goal !== undefined && goal !== initiative.goalUsd
        ? await requestGoal(db, round.manifest!, initiative, goal, c.var.user!.address)
        : null;
      const done = Number.isInteger(n) && n > 0
        ? await db.initiatives.review(initiative.id, n, verdict, c.var.user!.address, note, {
          keepGoal,
        }).catch(async (e) => {
          if (asked) await settleGoalRequest(db, asked);
          throw e;
        })
        : null;
      if (!done) {
        if (asked) await settleGoalRequest(db, asked);
        throw new HttpError(409, "That edit is no longer waiting for review.");
      }
      // Accepted: the live text changed, the vote card's bullets follow.
      if (verdict === "accept") rewriteBriefSoon(deps, initiative.id);
      return c.json({
        initiative: adminInitiative(
          done.initiative,
          canReadPrivateFields(done.initiative, c.var.user, deps.now()),
        ),
        revision: revisionMeta(done.revision),
      });
    });
  }

  /** `{ ids: string[], action }` for a bulk route: 1 to 100 distinct ids, a known action. */
  function readBulk(
    body: Record<string, unknown>,
    allowed: Record<string, unknown>,
  ): { ids: string[]; action: string } {
    const action = s(body.action, 20);
    if (!Object.hasOwn(allowed, action)) throw new HttpError(400, "bad action");
    const raw = Array.isArray(body.ids) ? body.ids : [];
    const ids = [...new Set(raw.map((v) => s(v, 40)).filter(Boolean))];
    if (!ids.length) throw new HttpError(400, "Select at least one row.");
    if (ids.length > 100) throw new HttpError(400, "At most 100 rows at once.");
    return { ids, action };
  }

  async function atomicBulk(
    ids: string[],
    run: () => Promise<{ done: number; failed: { id: string; error: string }[] }>,
  ) {
    try {
      return await stageDataset(
        db.kv,
        async () => {
          const result = await run();
          if (result.failed.length) {
            throw new DatasetAbort({
              done: 0,
              failed: ids.map((id) =>
                result.failed.find((f) => f.id === id) ??
                  { id, error: "No changes saved: another row in this batch failed." }
              ),
            });
          }
          return result;
        },
        [],
        db.now,
      );
    } catch (e) {
      if (e instanceof DatasetAbort) return e.result;
      throw e;
    }
  }

  const STATUS_ACTIONS: Record<string, Initiative["status"]> = {
    approve: "approved",
    reject: "rejected",
    archive: "archived",
    unarchive: "approved",
  };
  async function applyStatus(initiative: Initiative, action: string): Promise<Initiative> {
    if (!Object.hasOwn(STATUS_ACTIONS, action)) throw new HttpError(400, "bad action");
    const status = STATUS_ACTIONS[action];
    if (status !== "approved") return await db.initiatives.update(initiative.id, { status });
    // Deploy first, approve second: a live initiative always has its Safe.
    if (!initiative.safeAddress) {
      throw new HttpError(400, "Deploy the Safe first; approval needs a deployed, verified Safe.");
    }
    if (!categoriesOf(initiative).length) {
      throw new HttpError(400, "Add at least one category to approve.");
    }
    return await db.initiatives.unarchive(initiative.id);
  }

  r.post("/initiatives/:id/status", requireRecentAuth(deps.now), async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const action = s((await jsonBody(c, ["action"])).action, 20);
    auditContext(c, { target: initiative.id, detail: action });
    const next = await applyStatus(initiative, action);
    // Approved: the model writes its vote card's bullets. (A bulk approve leaves that to
    // the page, one request per initiative.)
    if (action === "approve") rewriteBriefSoon(deps, next.id);
    return c.json({
      initiative: adminInitiative(next, canReadPrivateFields(next, c.var.user, deps.now())),
    });
  });

  /** Apply the complete selection atomically; invalid rows roll back the batch. */
  r.post("/initiatives/bulk", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["ids", "action"]);
    const { ids, action } = readBulk(body, STATUS_ACTIONS);
    auditContext(c, { detail: action });
    return c.json(
      await atomicBulk(ids, async () => {
        const failed: { id: string; error: string }[] = [];
        let done = 0;
        for (const id of ids) {
          try {
            await auditedItem(deps, c, {
              action: "initiative.status",
              targetKind: "initiative",
              target: id,
              detail: action,
            }, async () => {
              const initiative = await db.initiatives.get(id);
              if (!initiative) throw new HttpError(404, "not found");
              await applyStatus(initiative, action);
            });
            done++;
          } catch (e) {
            failed.push({ id, error: e instanceof Error ? e.message : "failed" });
          }
        }
        auditContext(c, { outcome: failed.length ? "failure" : "success" });
        return { done, failed };
      }),
    );
  });

  /**
   * The pledge fields of a request: JSON, or multipart with an optional
   * `logo` image (pinned to IPFS). Only the keys sent come back, so the same
   * reader serves adding (everything required) and editing (a subset).
   */
  const PLEDGE_NOTE_CHARS = 300;
  async function readPledge(
    c: Context<Vars>,
    initiative: Initiative,
    /** "signed": the pledge goes on-chain, so the signature fields are required (checked
     * before any upload); "prepare": the body of a request for the typed data. */
    mode: "plain" | "signed" | "prepare" = "plain",
    /** In "signed" mode, whether the admin's wallet may sign the pledge: when it may not
     * and no signature was sent, the change is held as an awaiting request instead. */
    canSign?: () => Promise<boolean>,
    /** In "signed" mode, whether this change needs no signature (an edit of a pledge's
     * name, link, note or logo): sent unsigned, it is then saved as is (`unsigned`). */
    needsNoSignature?: (patch: PledgePatch, status: string | undefined) => Promise<boolean>,
  ) {
    const ct = c.req.header("content-type") ?? "";
    let fields: Record<string, unknown> = {};
    let logoCid: string | undefined;
    let logo: FormDataEntryValue | null = null;
    const allowed = [
      "company",
      "amount",
      "url",
      "note",
      "status",
      ...SIGNED_FIELDS,
      ...(mode === "prepare" ? ["remove"] : []),
    ];
    if (ct.startsWith("multipart/form-data")) {
      const form = await formBody(c, [...allowed, "logo"]);
      for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
      logo = form.get("logo");
    } else fields = await jsonBody(c, allowed);
    const patch: Partial<Pick<Pledge, "company" | "amountUsd" | "url" | "note" | "logoCid">> = {};
    // Past a cap is refused with the message, never cut.
    if (fields.company !== undefined) {
      patch.company = capped(fields.company, LIMITS.BACKER_ORG, "The company name");
      if (!patch.company) throw new HttpError(400, "Company name is required.");
    }
    const rawAmount = fields.amount;
    if (rawAmount !== undefined && rawAmount !== "") {
      const [amount, err] = parseGoal(rawAmount);
      if (err) throw new HttpError(400, err);
      patch.amountUsd = amount!;
    }
    if (fields.url !== undefined) {
      const [url, err] = validateHttpsLink(fields.url);
      if (err) throw new HttpError(400, err);
      patch.url = url!;
    }
    if (fields.note !== undefined) {
      patch.note = capped(fields.note, PLEDGE_NOTE_CHARS, "The note");
    }
    const status = typeof fields.status === "string" ? s(fields.status, 20) : undefined;
    let signed: ReturnType<typeof signedPledgeOf> | null = null;
    let awaiting = false;
    let unsigned = false;
    if (mode === "signed") {
      if (
        needsNoSignature && !hasSignature(fields) && (await needsNoSignature(patch, status))
      ) unsigned = true;
      else if (canSign && !hasSignature(fields) && !(await canSign())) awaiting = true;
      else signed = signedPledgeOf(fields);
    }
    // Validate fields before uploading anything to the external provider.
    if (logo instanceof File && logo.size) {
      if (logo.size > LOGO_MAX_BYTES) throw new HttpError(400, "Logo must be under 1 MB.");
      const [cid, err] = await deps.pinata.uploadImage(
        new Uint8Array(await logo.arrayBuffer()),
        LOGO_MAX_BYTES,
        "logo-" + initiative.slug,
      );
      if (!cid) throw new HttpError(400, err ?? "upload failed");
      logoCid = cid;
    }
    if (logoCid !== undefined) patch.logoCid = logoCid;
    return { patch, status, signed, awaiting, unsigned, fields };
  }

  /** Any of a pledge signature's own fields sent (the pid alone isn't one). */
  const hasSignature = (fields: Record<string, unknown>) =>
    ["nonce", "deadline", "signature"].some((k) => fields[k] !== undefined && fields[k] !== "");

  /** Does the admin's wallet hold the round's PLEDGE_ROLE? A failed read refuses the
   * request: never held as awaiting, never asked to sign, on a guess. */
  const canSignPledges = (
    c: Context<Vars>,
    chainAt: NonNullable<Awaited<ReturnType<typeof pledges.onChainFor>>>,
  ) =>
  async () => {
    try {
      return await chainAt.d.chain.hasRole(PLEDGE_ROLE_ID, c.var.user!.address as Hex);
    } catch (e) {
      deps.log(`admin pledge: hasRole read failed (${errorText(e)})`);
      throw new HttpError(
        503,
        "Couldn't check your wallet's role on the vote contract; try again.",
      );
    }
  };

  /** Hold a change as an awaiting request until a round admin signs it
   * (services/admin-pledges.ts `hold`): 202 `{ awaiting, pid }`, or 200 when nothing is
   * left to hold. */
  async function holdPledge(
    c: Context<Vars>,
    chainAt: NonNullable<Awaited<ReturnType<typeof pledges.onChainFor>>>,
    rfpId: string,
    pid: string,
    change: PledgeChange,
  ) {
    const r = await pledges.hold(chainAt.d, rfpId, pid, change, c.var.user!.address as Hex);
    return r === "held" ? c.json({ awaiting: true, pid }, 202) : c.json({ ok: true });
  }

  /**
   * During the real vote a pledge to an initiative in the round is signed and put
   * on-chain before it is saved (services/admin-pledges.ts); otherwise it is saved as is.
   */
  /** Write a change on-chain: the saved row when no transaction was needed, otherwise
   * the hash right after the broadcast (answered 202 `{ hash, pid }`; the form waits for
   * the receipt, then calls `settle`). */
  async function writeOnChain(
    c: Context<Vars>,
    chainAt: NonNullable<Awaited<ReturnType<typeof pledges.onChainFor>>>,
    rfpId: string,
    signed: ReturnType<typeof signedPledgeOf>,
    change: PledgeChange,
  ) {
    return await pledges.write({
      d: chainAt.d,
      initiativeId: chainAt.at.initiativeId,
      rfpId,
      admin: c.var.user!.address as Hex,
      signed,
      change,
    });
  }
  const sent = (r: { hash: Hex | null; pid: string }) => ({ hash: r.hash, pid: r.pid });

  /**
   * What an admin signs for a pledge during the real vote: the same body as adding or
   * editing (plus `pid` for an existing pledge, or `remove: true`), answered with the
   * pledge's id and the EIP-712 typed data to sign, nonce read fresh from the chain.
   */
  r.post("/initiatives/:id/pledges/prepare", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const chainAt = await pledges.onChainFor(initiative);
    if (!chainAt) {
      throw pledgeFail(
        409,
        "not_on_chain",
        "Pledges to this initiative are saved without signing.",
      );
    }
    const { patch, status, fields } = await readPledge(c, initiative, "prepare");
    if (
      fields.pid !== undefined && (typeof fields.pid !== "string" || !PLEDGE_ID_RE.test(fields.pid))
    ) {
      throw new HttpError(400, "bad pledge id");
    }
    if (status !== undefined && !["pledged", "received", "withdrawn"].includes(status)) {
      throw new HttpError(400, "bad status");
    }
    const pid = (fields.pid as string | undefined) ?? newId();
    // The change in flight first: the amount is the one after it.
    await pledges.settle(chainAt.d, initiative.id, pid);
    const stored = fields.pid === undefined ? null : await db.pledges.get(initiative.id, pid);
    let change: PledgeChange;
    if (fields.remove === true) {
      if (!stored) throw new HttpError(404, "not found");
      change = { kind: "remove" };
    } else if (stored) {
      change = { kind: "edit", patch, status: status as PledgeStatus | undefined };
    } else {
      // A new pledge (its id kept by the form until it is saved).
      if (!patch.company) throw new HttpError(400, "Company name is required.");
      if (patch.amountUsd === undefined) throw new HttpError(400, "Amount is required.");
      change = {
        kind: "add",
        row: {
          company: patch.company,
          amountUsd: patch.amountUsd,
          status: status === "received" ? "received" : "pledged",
          note: "",
          url: "",
          logoCid: "",
        },
      };
    }
    const typed = pledgeTypedData(chainAt.d.manifest, {
      pledgeId: pledgeChainId(pid),
      initiativeId: BigInt(chainAt.at.initiativeId),
      currencyId: 0n,
      amount: amountAfter(change, stored),
      nonce: await chainAt.d.chain.pledgeNonceOf(c.var.user!.address as Hex),
      deadline: BigInt(Math.floor(deps.now()) + PLEDGE_DEADLINE_SECS),
    });
    return c.json({
      pid,
      typedData: typedDataJson(typed),
    });
  });

  r.post("/initiatives/:id/pledges", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const chainAt = await pledges.onChainFor(initiative);
    const { patch, status, signed, awaiting } = await readPledge(
      c,
      initiative,
      chainAt ? "signed" : "plain",
      chainAt ? canSignPledges(c, chainAt) : undefined,
    );
    if (!patch.company) throw new HttpError(400, "Company name is required.");
    if (patch.amountUsd === undefined) throw new HttpError(400, "Amount is required.");
    const row = {
      company: patch.company,
      amountUsd: patch.amountUsd,
      status: status === "received" ? "received" as const : "pledged" as const,
      note: patch.note ?? "",
      url: patch.url ?? "",
      logoCid: patch.logoCid ?? "",
    };
    if (chainAt && awaiting) {
      return await holdPledge(c, chainAt, initiative.id, newId(), { kind: "add", row });
    }
    if (chainAt && signed) {
      const r = await writeOnChain(c, chainAt, initiative.id, signed, { kind: "add", row });
      if (r.pending) return c.json(sent(r), 202);
      return c.json({ pledge: adminPledgeJson(config, r.pledge!) }, 201);
    }
    const p = await db.pledges.add(initiative.id, row);
    return c.json({ pledge: adminPledgeJson(config, p) }, 201);
  });

  /** Edit a pledge: any of company, amount, url, note, logo (same body as adding), and status.
   * During the vote an edit that keeps the amount and status goes unsigned (`saveWords`). */
  r.patch("/initiatives/:id/pledges/:pid", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const pid = c.req.param("pid");
    const chainAt = await pledges.onChainFor(initiative);
    const { patch, status, signed, awaiting, unsigned } = await readPledge(
      c,
      initiative,
      chainAt ? "signed" : "plain",
      chainAt ? canSignPledges(c, chainAt) : undefined,
      // Its name, link, note or logo change nothing on-chain: any site admin saves them.
      chainAt
        ? async (patch, status) =>
          (await pledges.wordsOnly(chainAt.d, initiative.id, pid, patch, status)) !== null
        : undefined,
    );
    if (status !== undefined && !["pledged", "received", "withdrawn"].includes(status)) {
      throw new HttpError(400, "bad status");
    }
    if (chainAt && unsigned) {
      const next = await pledges.saveWords(chainAt.d, initiative.id, pid, patch, status);
      // Its amount or status changed since the check: the form sends it again.
      if (!next) {
        throw pledgeFail(
          409,
          "pledge_request_changed",
          "This pledge changed just now: send it again.",
        );
      }
      return c.json({ ok: true, pledge: adminPledgeJson(config, next) });
    }
    if (chainAt && awaiting) {
      return await holdPledge(c, chainAt, initiative.id, pid, {
        kind: "edit",
        patch,
        status: status as PledgeStatus | undefined,
      });
    }
    if (chainAt && signed) {
      if (signed.pid !== pid) throw new HttpError(400, "bad pledge id");
      const r = await writeOnChain(c, chainAt, initiative.id, signed, {
        kind: "edit",
        patch,
        status: status as PledgeStatus | undefined,
      });
      if (r.pending) return c.json(sent(r), 202);
      if (!r.pledge) throw new HttpError(404, "not found");
      return c.json({ ok: true, pledge: adminPledgeJson(config, r.pledge) });
    }
    await pledges.settleLeftover(initiative.id, pid);
    let next = await db.pledges.get(initiative.id, pid);
    if (!next) throw new HttpError(404, "not found");
    if (Object.keys(patch).length) next = await db.pledges.update(initiative.id, pid, patch);
    if (status !== undefined) {
      await db.pledges.setStatus(initiative.id, pid, status as PledgeStatus);
      next = await db.pledges.get(initiative.id, pid);
    }
    return c.json({ ok: true, pledge: adminPledgeJson(config, next!) });
  });

  r.delete("/initiatives/:id/pledges/:pid", async (c) => {
    const body = await jsonBody(c, SIGNED_FIELDS);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const pid = c.req.param("pid");
    const chainAt = await pledges.onChainFor(initiative);
    if (chainAt) {
      if (!hasSignature(body)) {
        // An awaiting add was never on-chain or saved: removing it drops the request.
        const held = await requests.get(chainAt.d, initiative.id, pid);
        if (
          held?.change.kind === "add" || !(await canSignPledges(c, chainAt)())
        ) return await holdPledge(c, chainAt, initiative.id, pid, { kind: "remove" });
      }
      const signed = signedPledgeOf(body);
      if (signed.pid !== pid) throw new HttpError(400, "bad pledge id");
      const r = await writeOnChain(c, chainAt, initiative.id, signed, { kind: "remove" });
      if (r.pending) return c.json(sent(r), 202);
      return c.json({ ok: true });
    }
    await pledges.settleLeftover(initiative.id, pid);
    await db.pledges.remove(initiative.id, pid);
    return c.json({ ok: true });
  });

  /** Discard a ballot initiative's goal request (any site admin, #149). The goal stays. */
  r.delete("/initiatives/:id/goal-request", async (c) => {
    await jsonBody(c, []);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    auditContext(c, { target: initiative.id });
    await dropGoalRequest(db, initiative.id);
    return c.json({ ok: true });
  });

  /** Discard an awaiting pledge request (any site admin). The pledge row is untouched. */
  r.delete("/initiatives/:id/pledge-requests/:pid", async (c) => {
    await jsonBody(c, []);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const d = await currentVote(deps);
    if (!d || !(await requests.discard(d, initiative.id, c.req.param("pid")))) {
      throw new HttpError(404, "not found");
    }
    return c.json({ ok: true });
  });

  /**
   * Save an awaiting pledge request as it is, once the real vote has closed (any site
   * admin): no signature can put it on-chain any more, so its change is applied like a
   * plain save and the request goes. 409 while the vote is still open.
   */
  r.post("/initiatives/:id/pledge-requests/:pid/save", async (c) => {
    await jsonBody(c, []);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const pid = c.req.param("pid");
    if (!PLEDGE_ID_RE.test(pid)) throw new HttpError(400, "bad pledge id");
    const d = await currentVote(deps);
    if (!d || d.manifest.kind !== "real") throw new HttpError(404, "not found");
    if (await pledges.onChainFor(initiative)) {
      throw new HttpError(409, "The vote is still open: a round admin signs it.");
    }
    const p = await pledges.saveHeld(d, initiative.id, pid);
    return c.json({ ok: true, pledge: p && adminPledgeJson(config, p) });
  });

  /**
   * The form's look after its own wait for a pledge's receipt: settles that change (the
   * chain is the truth) and says `saved` (with the row; null after a removal), `pending`
   * or `failed`.
   */
  r.post("/initiatives/:id/pledges/:pid/settle", async (c) => {
    const body = await jsonBody(c, ["hash"]);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const pid = c.req.param("pid");
    if (!PLEDGE_ID_RE.test(pid)) throw new HttpError(400, "bad pledge id");
    const hash = body.hash ?? null;
    if (hash !== null && (typeof hash !== "string" || !TX_HASH_RE.test(hash.toLowerCase()))) {
      throw new HttpError(400, "malformed tx hash");
    }
    const r = await pledges.settleSent(initiative.id, pid, hash as Hex | null);
    return c.json({ state: r.state, pledge: r.pledge && adminPledgeJson(config, r.pledge) });
  });

  /** An initiative's vote card bullets (#96) as stored, and whether they stand for its
   * live text. */
  r.get("/initiatives/:id/vote-brief", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    return c.json(await briefFor(deps, initiative.id));
  });

  /** Rewrite summary: the model writes the initiative's vote card bullets now (one call,
   * ~10 s). The bulk approve's page sends one of these per approved initiative, with
   * `missing: true`: nothing is written when they already stand for the live text. */
  r.post("/initiatives/:id/vote-brief", async (c) => {
    const body = await jsonBody(c, ["missing"]);
    if (body.missing !== undefined && typeof body.missing !== "boolean") {
      throw new HttpError(400, "missing must be true or false");
    }
    const initiative = await initiativeOr404(c.req.param("id"), true);
    auditContext(c, { target: initiative.id, detail: body.missing ? "missing" : "rewrite" });
    try {
      if (!(body.missing && (await briefFor(deps, initiative.id)).current)) {
        await writeBrief(deps, initiative.id);
      }
    } catch (e) {
      if (e instanceof AiError) throw new HttpError(503, e.reason);
      throw e;
    }
    return c.json(await briefFor(deps, initiative.id));
  });

  r.post("/initiatives/:id/donations/recheck", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const tx = s((await jsonBody(c, ["txHash"])).txHash, 80).toLowerCase();
    if (!TX_HASH_RE.test(tx)) throw new HttpError(400, "malformed tx hash");
    if (!initiative.safeAddress || !Object.keys(await chain.activeTokens()).length) {
      throw new HttpError(503, "chain unavailable or no Safe");
    }
    const v = await chain.verifyDonation(tx, initiative.safeAddress);
    if (v.found && !v.pending) await db.donations.record(initiative.id, tx, v, "tx");
    return c.json({ verification: v });
  });

  r.post("/initiatives/:id/sync-donations", async (c) => {
    await jsonBody(c, []);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    if (!initiative.safeAddress) throw new HttpError(400, "no Safe deployed");
    if (!(await db.rateLimit("safesync:" + initiative.id, 1, 60))) {
      throw new HttpError(429, "synced less than a minute ago");
    }
    return c.json({ safeSync: await refreshLedger(deps, initiative, true) });
  });

  /** What the admin's wallet sends to deploy this initiative's Safe, and where it lands. */
  r.get("/initiatives/:id/safe-deploy-params", async (c) => {
    const initiative = await initiativeOr404(c.req.param("id"), true);
    const [ok, why] = signersConfigured(config.operationalSigners);
    if (!ok) return c.json({ enabled: false, reason: why }, 503);
    const key = initiative.safeDeploymentKey ?? initiative.slug;
    const address = initiative.safeAddress || predictSafeAddress(config.operationalSigners, key);
    // "Deployed" is on-chain truth, not just our binding: a deploy the browser
    // lost track of (wallet mined it under another hash) must not be sent
    // again, since CREATE2 at an occupied address can only revert.
    const deployed = Boolean(initiative.safeAddress) || await chain.hasCode(address);
    return c.json({
      enabled: true,
      chainId: CHAIN_ID,
      factory: SAFE_PROXY_FACTORY,
      calldata: safeDeployCalldata(config.operationalSigners, key),
      signers: config.operationalSigners,
      threshold: SAFE_THRESHOLD,
      address,
      deployed,
    });
  });

  /**
   * Bind the Safe once it exists. The truth is code at the predicted CREATE2
   * address, not a tx hash: a Safe wallet or a sped-up tx mines under another
   * hash, so the browser watches its own receipt for a revert and asks here
   * until the Safe is there. What is there must pass the on-chain check
   * (owners, threshold, canonical proxy) and be unbound elsewhere.
   */
  r.post("/initiatives/:id/safe-confirm", requireRecentAuth(deps.now), async (c) => {
    await jsonBody(c, []);
    const initiative = await initiativeOr404(c.req.param("id"), true);
    if (initiative.safeAddress) {
      return c.json({ status: "ok", address: initiative.safeAddress, detail: "verified earlier" });
    }
    const [ok, why] = signersConfigured(config.operationalSigners);
    if (!ok) return c.json({ status: "error", detail: why }, 503);
    const address = predictSafeAddress(
      config.operationalSigners,
      initiative.safeDeploymentKey ?? initiative.slug,
    );
    if (!(await chain.hasCode(address))) {
      auditContext(c, { outcome: "pending" });
      return c.json({ status: "pending", detail: `no Safe at ${address} yet` });
    }
    const [good, detail] = await chain.verifySafe(address, config.operationalSigners);
    if (!good) {
      return c.json({ status: "error", detail: `Safe at ${address} REJECTED: ${detail}` }, 400);
    }
    const other = await db.initiatives.bySafe(address);
    if (other && other.id !== initiative.id) {
      return c.json({
        status: "error",
        detail: `that Safe is already assigned to another initiative (${other.slug})`,
      }, 409);
    }
    await db.initiatives.update(initiative.id, { safeAddress: address });
    return c.json({ status: "ok", address, detail });
  });

  /** The patch a moderation action makes on a comment, or a 400/409. */
  function commentPatch(row: Comment, action: string): Partial<Comment> {
    if (
      ["review", "feature"].includes(action) &&
      (row.parentId || row.status !== "published")
    ) {
      throw new HttpError(400, "only a published top-level entry");
    }
    if (action === "publish") return { status: "published" };
    if (action === "discard") return { status: "discarded" };
    if (action === "review" && row.type === "suggestion") return { reviewed: true };
    if (action === "feature") return { featured: 1, featuredAt: deps.now() };
    if (action === "unfeature") return { featured: 0, featuredAt: 0 };
    if (action === "unreport") return { reports: 0 };
    throw new HttpError(400, "bad action");
  }

  /** Bulk-safe moderation actions: the ones with no per-row precondition. */
  const BULK_COMMENT_ACTIONS: Record<string, true> = {
    publish: true,
    discard: true,
    unreport: true,
    rescreen: true,
  };
  /** Each re-run is a model call of up to 25 s, twice: a few at a time, 20 at most. */
  const RESCREEN_MAX = 20;
  const RESCREEN_PARALLEL = 5;

  r.post("/comments/bulk", async (c) => {
    const body = await jsonBody(c, ["ids", "action"]);
    const { ids, action } = readBulk(body, BULK_COMMENT_ACTIONS);
    if (action === "rescreen" && ids.length > RESCREEN_MAX) {
      throw new HttpError(400, `Re-run the AI screen on at most ${RESCREEN_MAX} rows at once.`);
    }
    auditContext(c, { detail: action });
    return c.json(
      await atomicBulk(ids, async () => {
        const failed: { id: string; error: string }[] = [];
        let done = 0;
        const one = async (id: string) => {
          try {
            await auditedItem(deps, c, {
              action: "comment.moderate",
              targetKind: "comment",
              target: id,
              detail: action,
            }, async () => {
              if (action === "rescreen") {
                await rescreen(deps, id);
                return;
              }
              const row = await db.comments.get(id);
              if (!row) throw new HttpError(404, "not found");
              await db.comments.set(row.id, commentPatch(row, action));
            });
            done++;
          } catch (e) {
            failed.push({ id, error: e instanceof Error ? e.message : "failed" });
          }
        };
        const step = action === "rescreen" ? RESCREEN_PARALLEL : 1;
        for (let i = 0; i < ids.length; i += step) {
          await Promise.all(ids.slice(i, i + step).map(one));
        }
        auditContext(c, { outcome: failed.length ? "failure" : "success" });
        return { done, failed };
      }),
    );
  });

  /** Ask the AI screen again about one held comment; it stays held. */
  r.post("/comments/:id/rescreen", async (c) => {
    await jsonBody(c, []);
    auditContext(c, { detail: "rescreen" });
    const next = await rescreen(deps, c.req.param("id"));
    const initiative = await db.initiatives.get(next.rfpId);
    return c.json({
      comment: adminCommentJson(
        next,
        liveRoles(await deps.admins.set(), next.address, initiative, false),
        initiative,
      ),
    });
  });

  r.post("/comments/:id/:action", async (c) => {
    await jsonBody(c, []);
    auditContext(c, { detail: c.req.param("action") });
    const row = await db.comments.get(c.req.param("id"));
    if (!row) throw new HttpError(404, "not found");
    const next = await db.comments.set(row.id, commentPatch(row, c.req.param("action")));
    const initiative = await db.initiatives.get(row.rfpId);
    return c.json({
      comment: adminCommentJson(
        next!,
        liveRoles(await deps.admins.set(), next!.address, initiative, false),
        initiative,
      ),
    });
  });

  /**
   * Dedicated funder-leads export. Other serializers apply the same fresh
   * administrator proof (or proposer ownership) at their field boundary.
   */
  r.get("/leads", requireRecentAuth(deps.now), async (c) => {
    const all = await db.initiatives.list(["pending", "approved", "rejected", "archived"]);
    // Every approved and pending initiative gets a row, with blank lead columns when it
    // has no leads yet; rejected and archived ones only while they carry leads.
    const rows = all.filter((x) =>
      x.funders.trim() || x.status === "approved" || x.status === "pending"
    ).map((x) => ({
      id: x.id,
      title: x.title,
      slug: x.slug,
      type: x.type,
      status: x.status,
      goalUsd: x.goalUsd,
      funders: x.funders,
      contact: x.contact,
      createdAt: x.createdAt,
    }));
    return c.json({ rows });
  });

  /**
   * A content logo (content/initiatives/logos/<name>), pinned to IPFS once: the same bytes
   * come back with the stored CID, new bytes replace it. The sync then maps
   * the name in a backers line to the CID. Multipart: `name`, `image`.
   */
  r.post("/logos", async (c) => {
    if (!deps.pinata.enabled) throw new HttpError(503, "Uploads are not enabled.");
    const form = await formBody(c, ["name", "image"]);
    const name = s(form.get("name"), 100).toLowerCase();
    if (!LOGO_NAME_RE.test(name)) {
      throw new HttpError(400, "Logo names are lowercase file names: png, jpg or webp.");
    }
    auditContext(c, { target: name });
    const image = form.get("image");
    if (!(image instanceof File) || !image.size) throw new HttpError(400, "Send the image file.");
    if (image.size > LOGO_MAX_BYTES) throw new HttpError(400, "Logo must be under 1 MB.");
    const bytes = new Uint8Array(await image.arrayBuffer());
    // Legacy pins were not decoded. Only reuse pins produced by this normalization policy.
    const sha256 = "raster-v1:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const have = await db.logos.get(name);
    if (have && have.sha256 === sha256) {
      return c.json({ name, cid: have.cid, logoUrl: ipfsUrl(config, have.cid), reused: true });
    }
    const [cid, err] = await deps.pinata.uploadImage(bytes, LOGO_MAX_BYTES, "content-logo-" + name);
    if (err) throw new HttpError(400, err);
    await db.logos.set(name, cid!, sha256);
    return c.json({ name, cid, logoUrl: ipfsUrl(config, cid!), reused: false });
  });

  /** Push-based content sync: the repo's content/initiatives/*.md, sent by scripts/sync-content.ts. */
  r.post("/sync-content", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, ["files"]);
    const files = Array.isArray(body.files) ? body.files : [];
    files.forEach((file, i) => {
      if (file && typeof file === "object") assertFields(file, ["name", "text"], `files[${i}].`);
    });
    const clean = files
      .filter((f): f is { name: string; text: string } =>
        f && typeof f === "object" && typeof f.name === "string" &&
        typeof f.text === "string"
      )
      .map((f) => ({ name: f.name.slice(0, 200), text: f.text.slice(0, 200_000) }));
    const result = await syncContent(
      db,
      clean,
      (name, run) =>
        auditedItem(deps, c, { action: "content.item", targetKind: "content", target: name }, run),
      await productionManifest(db),
    );
    auditContext(c, {
      outcome: result.errors.length
        ? result.created + result.updated ? "partial" : "failure"
        : "success",
    });
    return c.json(result);
  });

  return r;
}
