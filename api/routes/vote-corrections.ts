import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireRecentAuth } from "../middleware/auth.ts";
import { jsonBody } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { auditContext } from "../services/audit.ts";
import { currentVote } from "../services/vote-active.ts";
import { type CorrectionView, prepareCorrection } from "../../shared/vote/corrections.ts";
import type { VoteReplay } from "./vote.ts";

/** Mounted beneath adminRoutes' requireAdmin middleware. No chain writes occur here. */
export function voteCorrectionRoutes(deps: Deps, replay: VoteReplay) {
  const r = new Hono<Vars>();
  const view = async (): Promise<CorrectionView> => {
    const d = await currentVote(deps);
    if (!d) throw new HttpError(503, "No vote is deployed right now.");
    const supported = d.manifest.configRevision !== undefined && Boolean(d.chain.corrections);
    const base = {
      supported,
      manifest: d.manifest,
      now: deps.now(),
      settled: [] as number[],
      final: false,
      poolUsd: d.manifest.poolUsd,
      pendingPoolUsd: null,
      poolUpdateNonce: "0",
    };
    if (!supported) return base;
    const [state, money] = await Promise.all([replay(d), d.chain.corrections!()]);
    return {
      ...base,
      ...money,
      settled: [
        ...new Set(
          state.tiers.flatMap((t) => t.status === "settled" ? [...t.funded, ...t.covered] : []),
        ),
      ],
      final: state.closed,
    };
  };
  r.get("/", async (c) => c.json(await view()));
  r.post("/", requireRecentAuth(deps.now), async (c) => {
    const body = await jsonBody(c, [
      "action",
      "revision",
      "id",
      "account",
      "goalUsd",
      "rfp",
      "groups",
      "usdFeed",
      "disabled",
      "asset",
      "name",
      "uri",
      "opensAt",
      "firstTallyAt",
      "initialWindow",
      "maxWindows",
      "amountUsd",
      "nonce",
    ]);
    const state = await view();
    auditContext(c, { target: state.manifest.contract });
    try {
      return c.json(prepareCorrection(body, state));
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Invalid correction.");
    }
  });
  return r;
}
