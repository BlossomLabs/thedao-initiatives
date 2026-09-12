import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { commentJson, ipfsUrl, publicRfp } from "../lib/json.ts";
import { liveRoles } from "../services/roles.ts";
import type { Rfp } from "../db/types.ts";
import { SAFE_OWNER_COUNT, SAFE_THRESHOLD } from "../config.ts";
import { onrampLink } from "../lib/onramp.ts";
import type { FundingSummary } from "../services/funding.ts";

export interface Card {
  initiative: ReturnType<typeof publicRfp>;
  summary: FundingSummary;
  pct: number;
  backers: number;
  donations: number;
  logos: { company: string; logoUrl: string }[];
  funded: boolean;
  donationsEnabled: boolean;
  onramp: { url: string; prefilled: boolean };
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

export async function buildCard(deps: Deps, r: Rfp, tokensOk: boolean): Promise<Card> {
  const [summary, pledges, donations] = await Promise.all([
    deps.funding.summary(r),
    deps.db.pledges.list(r.id),
    deps.db.donations.list(r.id),
  ]);
  return {
    initiative: publicRfp(r),
    summary,
    pct: pctOf(summary.total, r.goalUsd),
    backers: pledges.length,
    donations: donations.length,
    logos: pledges.filter((p) => p.logoCid).slice(0, 4)
      .map((p) => ({ company: p.company, logoUrl: ipfsUrl(deps.config, p.logoCid) })),
    funded: Boolean(r.goalUsd && summary.total >= r.goalUsd),
    donationsEnabled: Boolean(tokensOk && r.safeAddress && r.status === "approved"),
    onramp: r.safeAddress ? onrampLink(deps.config, r.safeAddress) : { url: "", prefilled: false },
  };
}

export function boardRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  r.get("/", async (c) => {
    const state = await deps.chain.state();
    const tokensOk = Object.keys(await deps.chain.activeTokens()).length > 0;
    const rfps = await db.rfps.list(["approved"]);
    const cards = orderCards(
      await Promise.all(rfps.map((x) => buildCard(deps, x, tokensOk))),
    );
    const byId = new Map(rfps.map((x) => [x.id, x]));
    const community = (await db.comments.frontPage())
      .filter((cm) => byId.has(cm.rfpId)).slice(0, 3)
      .map((cm) => ({
        ...commentJson(cm, liveRoles(config, cm.address, byId.get(cm.rfpId))),
        initiative: { slug: byId.get(cm.rfpId)!.slug, title: byId.get(cm.rfpId)!.title },
      }));
    return c.json({
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
        onramp: Boolean(config.onrampApiKey),
        walletConnectProjectId: config.walletConnectProjectId,
        safeThreshold: SAFE_THRESHOLD,
        safeOwnerCount: SAFE_OWNER_COUNT,
      },
    });
  });
  return r;
}
