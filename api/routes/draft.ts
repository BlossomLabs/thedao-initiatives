import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonBody } from "../lib/body.ts";
import { HttpError } from "../lib/errors.ts";
import { bumpCounter } from "../db/ratelimit.ts";
import {
  AUTOSAVE_MAX_BYTES,
  AUTOSAVE_TTL_SECS,
  validAutosave,
} from "../../shared/draft/autosave.ts";

const CHUNK_BYTES = 60_000;
const PARTS = Math.ceil(AUTOSAVE_MAX_BYTES / CHUNK_BYTES);
interface Head {
  bytes: number;
  expiresAt: number;
}
/** Fixed slots fit in one getMany/atomic commit, including the versioned head.
 * Drafts and deletion tombstones expire; neither is included in admin restores. */
export function draftRoutes({ db, now }: Deps) {
  const r = new Hono<Vars>();
  r.use("*", requireAuth);
  r.use("/:owner", async (c, next) => {
    if (c.req.param("owner").toLowerCase() !== c.var.user!.address.toLowerCase()) {
      throw new HttpError(403, "This draft belongs to another wallet.");
    }
    c.header("Cache-Control", "no-store");
    await next();
  });
  const keys = (
    owner: string,
  ): Deno.KvKey[] => [
    ["private_draft", owner, "head"],
    ...Array.from({ length: PARTS }, (_, i) => ["private_draft", owner, i]),
  ];
  r.get("/:owner", async (c) => {
    const rows = await db.kv.getMany(keys(c.var.user!.address.toLowerCase()));
    const head = rows[0].value as Head | null;
    if (!head || head.expiresAt <= now() || !head.bytes) {
      return c.json({ version: rows[0].versionstamp, data: null });
    }
    const data = new Uint8Array(head.bytes);
    for (let i = 0; i < Math.ceil(head.bytes / CHUNK_BYTES); i++) {
      const part = rows[i + 1].value;
      if (!(part instanceof Uint8Array)) {
        throw new HttpError(503, "The saved draft could not be loaded. Please retry.");
      }
      data.set(part, i * CHUNK_BYTES);
    }
    return c.json({
      version: rows[0].versionstamp,
      data: JSON.parse(new TextDecoder().decode(data)),
    });
  });
  const write = async (c: import("hono").Context<Vars>, remove: boolean) => {
    const body = await jsonBody(c, remove ? ["version"] : ["version", "data"]);
    if (
      !(body.version === null ||
        typeof body.version === "string" && /^[0-9a-f]{20}$/.test(body.version))
    ) {
      throw new HttpError(400, "Load the saved draft before changing it.");
    }
    if (!remove && body.data !== null && !validAutosave(body.data)) {
      throw new HttpError(400, "Invalid draft.");
    }
    const bytes = new TextEncoder().encode(
      remove || body.data === null ? "" : JSON.stringify(body.data),
    );
    if (bytes.length > AUTOSAVE_MAX_BYTES) {
      throw new HttpError(413, "The draft exceeds the 256 KiB autosave limit.");
    }
    const owner = c.var.user!.address.toLowerCase();
    const window = Math.floor(now() / 60);
    if (await bumpCounter(db.kv, ["rl", "draft:" + owner, window], 65_000) > 180) {
      throw new HttpError(429, "Draft saving is too frequent. Please wait a moment.");
    }
    const slots = keys(owner);
    const opts = { expireIn: AUTOSAVE_TTL_SECS * 1000 };
    const op = db.kv.atomic().check({ key: slots[0], versionstamp: body.version })
      .set(
        slots[0],
        { bytes: bytes.length, expiresAt: now() + AUTOSAVE_TTL_SECS } satisfies Head,
        opts,
      );
    for (let i = 0; i < PARTS; i++) {
      if (i * CHUNK_BYTES < bytes.length) {
        op.set(slots[i + 1], bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES), opts);
      } else op.delete(slots[i + 1]);
    }
    const result = await op.commit();
    if (!result.ok) {
      throw new HttpError(409, "This draft changed in another tab. Reload before saving again.");
    }
    return c.json({ version: result.versionstamp, data: remove ? null : body.data });
  };
  r.put("/:owner", (c) => write(c, false));
  r.delete("/:owner", (c) => write(c, true));
  return r;
}
