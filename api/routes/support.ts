/**
 * Support widget inbox: the message is tagged with the site, category and
 * page, then forwarded to SUPPORT_URL (Blossom's support service, Octo's
 * contract: {name, email, message, screenshot?}). Nothing is stored here.
 */
import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { requireClientIp } from "../middleware/ip.ts";
import { jsonBody, s } from "../lib/body.ts";
import { capped, EMAIL_RE } from "../lib/validate.ts";
import { SUPPORT_MESSAGES_PER_HOUR_PER_IP } from "../config.ts";
import {
  isSupportCategory,
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_SCREENSHOT_MAX,
} from "../../shared/support.ts";

const SITE_TAG = "TheDAO Initiatives";
const SCREENSHOT_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function supportRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  r.post("/support", async (c) => {
    if (!config.supportUrl) throw new HttpError(503, "support is not configured");
    const body = await jsonBody(c, ["category", "message", "email", "screenshot", "page"]);
    const category = body.category;
    if (!isSupportCategory(category)) throw new HttpError(400, "pick a category");
    const message = capped(body.message, SUPPORT_MESSAGE_MAX, "The message");
    if (!message) throw new HttpError(400, "write a message");
    const email = s(body.email, 200);
    if (email && !EMAIL_RE.test(email)) {
      throw new HttpError(400, "that email does not look right");
    }
    const screenshot = s(body.screenshot, SUPPORT_SCREENSHOT_MAX + 1);
    if (
      screenshot && (screenshot.length > SUPPORT_SCREENSHOT_MAX || !SCREENSHOT_RE.test(screenshot))
    ) {
      throw new HttpError(400, "screenshot must be a small data-URL image");
    }
    // Only a path on this site becomes a link; anything else is dropped.
    const page = s(body.page, 500);
    const pageUrl = page.startsWith("/") && !page.startsWith("//")
      ? config.webOrigins[0] + page
      : "";
    if (
      !(await db.rateLimit("support:" + requireClientIp(c), SUPPORT_MESSAGES_PER_HOUR_PER_IP, 3600))
    ) {
      throw new HttpError(429, "too many messages, try again in an hour");
    }
    const header = [
      `[${SITE_TAG} · ${SUPPORT_CATEGORIES[category]}]`,
      ...(pageUrl ? [`Page: ${pageUrl}`] : []),
    ];
    const text = header.join("\n") + "\n\n" + message;
    let res: Response;
    try {
      res = await deps.fetch(config.supportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "",
          email,
          message: text,
          ...(screenshot ? { screenshot } : {}),
        }),
      });
    } catch (e) {
      deps.log(`support forward failed: ${String(e)}`);
      throw new HttpError(502, "could not deliver the message, try again");
    }
    if (!res.ok) {
      deps.log(`support upstream ${res.status}: ${(await res.text()).slice(0, 200)}`);
      throw new HttpError(502, "could not deliver the message, try again");
    }
    return c.json({ ok: true });
  });

  return r;
}
