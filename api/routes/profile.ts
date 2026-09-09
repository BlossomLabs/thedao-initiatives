import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { requireAuth } from "../middleware/auth.ts";
import { isAddress } from "../chain/address.ts";
import { DOMAIN_RE, NICK_RE, PRESET_RE } from "../lib/validate.ts";
import { pfpUrl } from "../lib/json.ts";

export const PFP_MAX_BYTES = 512 * 1024;

export function profileRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config, ens } = deps;

  /** Reverse-resolve an address to its primary ENS name (or null). */
  r.get("/ens-name/:address", async (c) => {
    const address = c.req.param("address").trim();
    if (!isAddress(address)) throw new HttpError(400, "bad address");
    // Cache misses hit an external API: throttle uncached lookups per client.
    if (!ens.has(address) && !(await db.rateLimit("ens:" + c.var.ip, 30, 60))) {
      return c.json({ name: null, detail: "rate limited" }, 429);
    }
    const name = await ens.reverse(address);
    return c.json({ name: name || null });
  });

  r.get("/nickname/:address", async (c) => {
    const address = c.req.param("address").trim();
    if (!isAddress(address)) throw new HttpError(400, "bad address");
    const p = await db.profiles.get(address);
    return c.json({
      nickname: p.nickname || null,
      pfp: p.pfp,
      pfpUrl: pfpUrl(config, p.pfp),
    });
  });

  /**
   * A name that LOOKS like a domain (e.g. "griff.eth") is accepted only if the
   * session wallet owns it (forward-resolves to it). Plain names are
   * first-come-first-served.
   */
  r.post("/nickname", requireAuth, async (c) => {
    const addr = c.var.user!.address;
    const body = await jsonBody(c);
    const raw = s(body.nickname, 100);
    if (!raw) throw new HttpError(400, "Pick a name first.");
    if (raw.length > 40 || !NICK_RE.test(raw)) {
      throw new HttpError(400, "Names are 1-40 letters, numbers, spaces or . _ -");
    }
    if (!(await db.rateLimit("nick:" + addr.toLowerCase(), 10, 60))) {
      throw new HttpError(429, "Too many tries, slow down a moment.");
    }
    if (DOMAIN_RE.test(raw.toLowerCase())) {
      const owner = await ens.forward(raw);
      if (!owner || owner.toLowerCase() !== addr.toLowerCase()) {
        throw new HttpError(
          403,
          `You can only use a domain you own. Connect the wallet that ${raw} points to.`,
        );
      }
    } else {
      const taken = await db.profiles.nicknameOwner(raw);
      if (taken && taken !== addr.toLowerCase()) {
        throw new HttpError(409, "That name is already taken, pick another.");
      }
    }
    if (!(await db.profiles.setNickname(addr, raw))) {
      throw new HttpError(409, "That name is already taken, pick another.");
    }
    return c.json({ nickname: raw });
  });

  r.post("/pfp", requireAuth, async (c) => {
    const addr = c.var.user!.address;
    const body = await jsonBody(c);
    const pfp = s(body.pfp, 20);
    if (!PRESET_RE.test(pfp)) throw new HttpError(400, "Pick one of the preset avatars.");
    if (!(await db.rateLimit("pfp:" + addr.toLowerCase(), 20, 60))) {
      throw new HttpError(429, "Too many tries, slow down a moment.");
    }
    await db.profiles.setPfp(addr, pfp);
    return c.json({ pfp, pfpUrl: "" });
  });

  /** Custom picture: multipart `image`, validated by magic bytes, pinned to IPFS. */
  r.post("/pfp/upload", requireAuth, async (c) => {
    const addr = c.var.user!.address;
    if (!deps.pinata.enabled) {
      throw new HttpError(503, "Image uploads are not configured.");
    }
    if (!(await db.rateLimit("pfpup:" + addr.toLowerCase(), 10, 3600))) {
      throw new HttpError(429, "Too many uploads, slow down.");
    }
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("image");
    if (!(file instanceof File) || !file.size) {
      throw new HttpError(400, "Choose an image.");
    }
    if (file.size > PFP_MAX_BYTES) {
      throw new HttpError(400, "Image must be under 500 KB.");
    }
    const [cid, err] = await deps.pinata.uploadImage(
      new Uint8Array(await file.arrayBuffer()),
      PFP_MAX_BYTES,
      "pfp-" + addr.slice(2, 10),
    );
    if (!cid) throw new HttpError(400, err ?? "upload failed");
    const pfp = "ipfs:" + cid;
    await db.profiles.setPfp(addr, pfp);
    return c.json({ pfp, pfpUrl: pfpUrl(config, pfp) });
  });

  return r;
}
