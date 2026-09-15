import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";

export function healthRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  r.get("/", async (c) => {
    const state = await deps.chain.state();
    return c.json({
      ok: true,
      tokensOk: Object.entries(state.tokens).filter(([, t]) => t.ok).map(([s]) => s)
        .sort(),
      detail: state.detail,
    });
  });
  return r;
}
