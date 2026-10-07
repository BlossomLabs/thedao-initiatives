import { type Context, Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonBody } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";

const WRITES_PER_MINUTE = 60;

/** The signed-in account's watchlist. Add and remove are explicit (PUT / DELETE). */
export function watchlistRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db } = deps;
  r.use("*", requireAuth);

  const me = (c: Context<Vars>) => c.var.user!.address;
  const limit = async (address: string) => {
    if (!(await db.rateLimit("watchlist:" + address.toLowerCase(), WRITES_PER_MINUTE, 60))) {
      throw new HttpError(429, "slow down");
    }
  };
  const approvedIds = async () =>
    new Set((await db.initiatives.cards("approved")).map((x) => x.id));
  const none = () => new HttpError(404, "no watchlist");
  const full = () => new HttpError(400, "watchlist is full");

  r.get("/", async (c) => {
    const ids = await db.watchlists.get(me(c));
    if (!ids) throw none();
    return c.json({ ids });
  });

  r.post("/import", async (c) => {
    const address = me(c);
    await limit(address);
    const body = await jsonBody(c, ["ids"]);
    const raw = body.ids;
    if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) {
      throw new HttpError(400, "ids must be a list of initiative ids");
    }
    const ids = await db.watchlists.importIds(address, raw as string[], await approvedIds());
    if (ids === "full") throw full();
    return c.json({ ids });
  });

  r.put("/:id", async (c) => {
    const address = me(c);
    await limit(address);
    const id = c.req.param("id");
    if (!(await approvedIds()).has(id)) throw new HttpError(404, "no such initiative");
    const ids = await db.watchlists.add(address, id);
    if (!ids) throw none();
    if (ids === "full") throw full();
    return c.json({ ids });
  });

  r.delete("/:id", async (c) => {
    const address = me(c);
    await limit(address);
    const ids = await db.watchlists.remove(address, c.req.param("id"));
    if (!ids) throw none();
    return c.json({ ids });
  });

  return r;
}
