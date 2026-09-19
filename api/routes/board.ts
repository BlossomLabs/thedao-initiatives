import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { cardInitiative, ipfsUrl } from "../lib/json.ts";
import type { Donation, Initiative, Pledge } from "../db/types.ts";
import { SAFE_OWNER_COUNT, SAFE_THRESHOLD } from "../config.ts";
import type { FundingSummary } from "../services/funding.ts";
import { chainStateFresh, tokensUsable } from "../chain/mod.ts";
import { ledgerStatus, refreshLedgers } from "../services/ledger.ts";
import { createSnapshotCache, type SnapshotCache } from "../lib/snapshot-cache.ts";

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

export async function buildCard(
  deps: Deps,
  r: Initiative,
  tokensOk: boolean,
  refresh = false,
): Promise<Card> {
  // One wave of reads, then only the Safe balance snapshot for the summary.
  const [pledges, donations, ledger] = await Promise.all([
    deps.db.pledges.list(r.id),
    deps.db.donations.list(r.id),
    ledgerStatus(deps, r),
  ]);
  const summary = await deps.funding.summaryFrom(r, pledges, donations, refresh);
  const withLogo = pledges.filter((p) => p.logoCid);
  return {
    initiative: cardInitiative(r),
    summary,
    pct: pctOf(summary.total, r.goalUsd),
    backers: backerCount(pledges, donations),
    donations: donations.length,
    ledger,
    logos: (withLogo.length ? withLogo : pledges).slice(0, 4)
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
  const [initiatives, state] = await Promise.all([
    db.initiatives.list(["approved"]),
    deps.chain.state(refresh),
  ]);
  if (refresh) await refreshLedgers(deps, initiatives);
  const tokensOk = tokensUsable(state);
  const cards = orderCards(
    await Promise.all(initiatives.map((x) => buildCard(deps, x, tokensOk, refresh))),
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
      aiSearch: deps.ai.enabled,
      tokensOk,
      chainDetail: state.detail,
      uploads: deps.pinata.enabled,
      support: Boolean(config.supportUrl),
      walletConnectProjectId: config.walletConnectProjectId,
      safeThreshold: SAFE_THRESHOLD,
      safeOwnerCount: SAFE_OWNER_COUNT,
    },
  };
}

export function boardRoutes(deps: Deps, cache: BoardCache = createBoardCache(deps)) {
  const r = new Hono<Vars>();
  const { config } = deps;

  // The global profile/support UI must not load or poll the funding board.
  r.get("/settings", async (c) => {
    const { on, at, note } = await deps.maintenance.state();
    return c.json({
      uploads: deps.pinata.enabled,
      support: Boolean(config.supportUrl),
      maintenance: { on, at, note },
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
