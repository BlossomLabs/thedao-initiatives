import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { commentJson, ipfsUrl, publicRfp } from "../lib/json.ts";
import { liveRoles } from "../services/roles.ts";
import type { Rfp } from "../db/types.ts";
import { SAFE_OWNER_COUNT, SAFE_THRESHOLD } from "../config.ts";
import type { FundingSummary } from "../services/funding.ts";
import { chainStateFresh, tokensUsable } from "../chain/mod.ts";
import { ledgerStatus, refreshLedgers } from "../services/ledger.ts";

export interface Card {
  initiative: ReturnType<typeof publicRfp>;
  summary: FundingSummary;
  pct: number;
  backers: number;
  donations: number;
  ledger: Awaited<ReturnType<typeof ledgerStatus>>;
  logos: { company: string; logoUrl: string; url: string }[];
  funded: boolean;
  donationsEnabled: boolean;
}

export const pctOf = (total: number, goal: number): number =>
  goal ? Math.min(100, Math.round((1000 * total) / goal) / 10) : 0;

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
  r: Rfp,
  tokensOk: boolean,
  refresh = false,
): Promise<Card> {
  const [summary, pledges, donations, ledger] = await Promise.all([
    deps.funding.summary(r, refresh),
    deps.db.pledges.list(r.id),
    deps.db.donations.list(r.id),
    ledgerStatus(deps, r),
  ]);
  return {
    initiative: publicRfp(r),
    summary,
    pct: pctOf(summary.total, r.goalUsd),
    backers: pledges.length,
    donations: donations.length,
    ledger,
    logos: pledges.filter((p) => p.logoCid).slice(0, 4)
      .map((p) => ({ company: p.company, logoUrl: ipfsUrl(deps.config, p.logoCid), url: p.url })),
    funded: Boolean(r.goalUsd && summary.total >= r.goalUsd),
    donationsEnabled: Boolean(tokensOk && r.safeAddress && r.status === "approved"),
  };
}

export function boardRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  // The global profile/support UI must not load or poll the funding board.
  r.get(
    "/settings",
    (c) => c.json({ uploads: deps.pinata.enabled, support: Boolean(config.supportUrl) }),
  );

  r.get("/", async (c) => {
    const refresh = c.req.query("refresh") === "1";
    const rfps = await db.rfps.list(["approved"]);
    const [state] = await Promise.all([
      deps.chain.state(refresh),
      refresh ? refreshLedgers(deps, rfps) : Promise.resolve(),
    ]);
    const tokensOk = tokensUsable(state);
    const cards = orderCards(
      await Promise.all(
        rfps.map((x) => buildCard(deps, x, tokensOk, refresh)),
      ),
    );
    const byId = new Map(rfps.map((x) => [x.id, x]));
    const admins = await deps.admins.set();
    const community = (await db.comments.frontPage())
      .filter((cm) => byId.has(cm.rfpId)).slice(0, 3)
      .map((cm) => ({
        ...commentJson(cm, liveRoles(admins, cm.address, byId.get(cm.rfpId))),
        initiative: { slug: byId.get(cm.rfpId)!.slug, title: byId.get(cm.rfpId)!.title },
      }));
    return c.json({
      refreshDue: !chainStateFresh(state, deps.now()),
      cards,
      totals: {
        count: cards.length,
        goal: cards.reduce((n, x) => n + x.initiative.goalUsd, 0),
        raised: cards.reduce((n, x) => n + x.summary.total, 0),
        backers: cards.reduce((n, x) => n + x.backers, 0),
        donations: cards.reduce((n, x) => n + x.donations, 0),
      },
      community,
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
    });
  });
  return r;
}
