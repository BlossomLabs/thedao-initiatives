import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { cardInitiative, ipfsUrl } from "../lib/json.ts";
import type { Donation, Pledge } from "../db/types.ts";
import type { CardRow } from "../db/initiatives.ts";
import type { CardSummary } from "../db/cards.ts";
import { SAFE_OWNER_COUNT, SAFE_THRESHOLD } from "../config.ts";
import type { FundingSummary } from "../services/funding.ts";
import { chainStateFresh, tokensUsable } from "../chain/mod.ts";
import { ledgerStatus, refreshLedgers } from "../services/ledger.ts";
import { createSnapshotCache, type SnapshotCache } from "../lib/snapshot-cache.ts";
import { DEFAULT_VOTE, type VoteSettings, voteState } from "../../shared/vote.ts";

/** The vote-eligibility settings, the defaults until an admin saves them. */
export const voteSettings = async (deps: Pick<Deps, "db">): Promise<VoteSettings> => ({
  ...DEFAULT_VOTE,
  ...(await deps.db.meta.getPublic<VoteSettings>("vote_settings")),
});

export interface Card {
  initiative: ReturnType<typeof cardInitiative>;
  summary: FundingSummary;
  pct: number;
  /** Pledgers and donors together (backerCount). */
  backers: number;
  donations: number;
  ledger: Awaited<ReturnType<typeof ledgerStatus>>;
  /** The "Pledged by" strip, at most four: the pledgers with a logo, or, while none
   * has one, the pledgers themselves with an empty `logoUrl` (drawn as silhouettes). */
  logos: { company: string; logoUrl: string; url: string }[];
  funded: boolean;
  donationsEnabled: boolean;
  /** Where it stands for TheDAO's vote; only while the vote display is on. */
  vote?: ReturnType<typeof voteState>["kind"];
}

export const pctOf = (total: number, goal: number): number =>
  goal ? Math.min(100, Math.round((1000 * total) / goal) / 10) : 0;

/** Everyone behind an initiative: open pledges, plus each distinct address with a
 * confirmed donation. A received pledge was paid, so its backer is already among
 * the donors and is not counted a second time. */
export function backerCount(pledges: Pledge[], donations: Donation[]): number {
  const donors = new Set(donations.map((d) => d.donor.toLowerCase()).filter(Boolean));
  return pledges.filter((p) => p.status === "pledged").length + donors.size;
}

/** Board order: admin pins first (1 = top), then total raised, newest on ties. */
export function orderCards<
  T extends {
    initiative: { sortRank: number | null; createdAt: number };
    summary: { total: number };
  },
>(cards: T[]): T[] {
  const key = (c: T) => {
    const rank = c.initiative.sortRank;
    const pinned = rank !== null && rank > 0;
    return [pinned ? 0 : 1, pinned ? rank : 0, -c.summary.total, -c.initiative.createdAt];
  };
  return [...cards].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
}

/** From the card row and its summary (#46, #47): one wave for the ledger status
 * and the Safe balance snapshot, no pledge or donation rows. */
export async function buildCard(
  deps: Deps,
  r: CardRow,
  s: CardSummary,
  tokensOk: boolean,
  refresh = false,
): Promise<Card> {
  const sumOf = (status: Pledge["status"]) =>
    s.pledges.filter((p) => p.status === status).reduce((n, p) => n + p.amountUsd, 0);
  const [summary, ledger] = await Promise.all([
    deps.funding.summaryOf(
      r,
      { pledged: sumOf("pledged"), received: sumOf("received"), ledger: s.donatedUsd },
      refresh,
    ),
    ledgerStatus(deps, r),
  ]);
  const withLogo = s.pledges.filter((p) => p.logoCid);
  return {
    initiative: cardInitiative(r),
    summary,
    pct: pctOf(summary.total, r.goalUsd),
    // The same rule as backerCount, from the summary's counts.
    backers: s.pledges.filter((p) => p.status === "pledged").length + s.donors,
    donations: s.donations,
    ledger,
    logos: (withLogo.length ? withLogo : s.pledges).slice(0, 4)
      .map((p) => ({ company: p.company, logoUrl: ipfsUrl(deps.config, p.logoCid), url: p.url })),
    funded: Boolean(r.goalUsd && summary.total >= r.goalUsd),
    donationsEnabled: Boolean(tokensOk && r.safeAddress && r.status === "approved"),
  };
}

/** The card with every "refresh me" flag off, for a paused refresh. */
export function quietCard<T extends Card>(card: T): T {
  return {
    ...card,
    summary: { ...card.summary, refreshDue: false },
    ledger: card.ledger ? { ...card.ledger, refreshDue: false } : card.ledger,
  };
}

/** The board as built, before a maintenance pause quiets it. */
export type BoardCache = SnapshotCache<Awaited<ReturnType<typeof buildBoard>>>;

/** Each isolate serves its last built board for a few seconds: it is public, polled, and costs
 * a KV read wave per card. app.ts clears it after every write request. */
export const createBoardCache = (deps: Deps): BoardCache =>
  createSnapshotCache(deps.now, deps.config.boardCacheSecs);

async function buildBoard(deps: Deps, refresh: boolean) {
  const { db, config } = deps;
  const [initiatives, state, vote] = await Promise.all([
    db.initiatives.cards("approved"),
    deps.chain.state(refresh),
    voteSettings(deps),
  ]);
  if (refresh) await refreshLedgers(deps, initiatives);
  const tokensOk = tokensUsable(state);
  const summaries = await db.cards.summaries(initiatives.map((x) => x.id));
  const cards = orderCards(
    await Promise.all(
      initiatives.map((x, i) => buildCard(deps, x, summaries[i], tokensOk, refresh)),
    ),
  ).map((c): Card =>
    vote.show ? { ...c, vote: voteState(c.summary.total, c.initiative.goalUsd, vote).kind } : c
  );
  return {
    refreshDue: !chainStateFresh(state, deps.now()),
    cards,
    totals: {
      count: cards.length,
      goal: cards.reduce((n, x) => n + x.initiative.goalUsd, 0),
      raised: cards.reduce((n, x) => n + x.summary.total, 0),
      backers: cards.reduce((n, x) => n + x.backers, 0),
      donations: cards.reduce((n, x) => n + x.donations, 0),
    },
    flags: {
      aiSearch: deps.ai.searchEnabled,
      aiSearchAuto: deps.ai.searchEnabled && config.typesafeEnabled,
      tokensOk,
      chainDetail: state.detail,
      uploads: deps.pinata.enabled,
      support: Boolean(config.supportUrl),
      walletConnectProjectId: config.walletConnectProjectId,
      safeThreshold: SAFE_THRESHOLD,
      safeOwnerCount: SAFE_OWNER_COUNT,
      vote,
    },
  };
}

/** The board as the public GET serves it (no refresh), for the feeds. */
export const readBoard = (deps: Deps, cache: BoardCache) =>
  cache.get(() => buildBoard(deps, false));

export function boardRoutes(deps: Deps, cache: BoardCache = createBoardCache(deps)) {
  const r = new Hono<Vars>();
  const { config } = deps;

  // The global profile/support UI must not load or poll the funding board.
  r.get("/settings", async (c) => {
    const [{ on, at, note }, vote] = await Promise.all([
      deps.maintenance.state(),
      voteSettings(deps),
    ]);
    return c.json({
      uploads: deps.pinata.enabled,
      support: Boolean(config.supportUrl),
      maintenance: { on, at, note },
      vote,
    });
  });

  r.get("/", async (c) => {
    // Maintenance pauses the background refreshes a read may trigger; the
    // response then says nothing is due so the client stops asking.
    const asked = c.req.query("refresh") === "1";
    const paused = asked && await deps.maintenance.on();
    // A refresh is always built, and is then the newest board this isolate has.
    const board = asked && !paused
      ? await cache.rebuild(() => buildBoard(deps, true))
      : await cache.get(() => buildBoard(deps, false));
    return c.json(
      paused ? { ...board, refreshDue: false, cards: board.cards.map(quietCard) } : board,
    );
  });
  return r;
}
