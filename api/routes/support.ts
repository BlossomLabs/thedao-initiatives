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
  parsePledgeAmount,
  PLEDGE_CONTACT_MAX,
  PLEDGE_ORG_MAX,
  receiptTransactionError,
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_SCREENSHOT_MAX,
  SUPPORT_TRANSACTION_URL_MAX,
} from "../../shared/support.ts";
import { commentLinks } from "../../shared/comment-links.ts";
import type { SupportScreen } from "../services/ai.ts";

const SITE_TAG = "TheDAO Initiatives";

const VERDICT_WORD = { genuine: "Genuine", unclear: "Unclear", spam: "SPAM" } as const;

/** "AI screen: SPAM: <summary>", or why the screen gave no answer. */
export function supportScreenLine(s: SupportScreen): string {
  if (!s.verdict) return `AI screen failed: ${s.error}`;
  return `AI screen: ${VERDICT_WORD[s.verdict]}${s.summary ? `: ${s.summary}` : ""}`;
}
const SCREENSHOT_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function supportRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  r.post("/support", async (c) => {
    if (!config.supportUrl) throw new HttpError(503, "support is not configured");
    const body = await jsonBody(c, [
      "category",
      "message",
      "email",
      "transactionUrl",
      "initiativeId",
      "pledgeAmount",
      "pledgeOrg",
      "pledgeContact",
      "screenshot",
      "page",
    ]);
    const category = body.category;
    if (!isSupportCategory(category)) throw new HttpError(400, "pick a category");
    const receipt = category === "receipt";
    const pledge = category === "pledge";
    const message = capped(body.message, SUPPORT_MESSAGE_MAX, "The message");
    if (!receipt && !message) throw new HttpError(400, "write a message");
    const email = receipt || pledge ? capped(body.email, 200, "The email") : s(body.email, 200);
    if (receipt && !email) throw new HttpError(400, "add an email for the receipt");
    if (pledge && !email) throw new HttpError(400, "add a pledge contact email");
    if (email && !EMAIL_RE.test(email)) {
      throw new HttpError(400, "that email does not look right");
    }
    const transactionUrl = s(body.transactionUrl, SUPPORT_TRANSACTION_URL_MAX + 1);
    if (receipt) {
      const error = receiptTransactionError(transactionUrl);
      if (error) throw new HttpError(400, error);
    } else if (body.transactionUrl !== undefined) {
      throw new HttpError(400, "transaction links are only supported for receipt requests");
    }
    let contact = "";
    const pledgeInfo: string[] = [];
    if (pledge) {
      const initiativeId = capped(body.initiativeId, 100, "The initiative ID");
      const initiative = initiativeId ? await db.initiatives.get(initiativeId) : null;
      if (!initiative || initiative.status !== "approved") {
        throw new HttpError(400, "select an available initiative");
      }
      const amount = parsePledgeAmount(body.pledgeAmount);
      if (amount === null) {
        throw new HttpError(400, "Enter a pledge amount between $0.01 and $100,000,000 (USD).");
      }
      const org = capped(body.pledgeOrg, PLEDGE_ORG_MAX, "The pledge org");
      if (!org) throw new HttpError(400, "add a pledge org");
      contact = capped(body.pledgeContact, PLEDGE_CONTACT_MAX, "The contact name");
      if (!contact) throw new HttpError(400, "tell us who we are talking with");
      const usd = (n: number) =>
        n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
      pledgeInfo.push(
        `Title: ${initiative.title}`,
        `Link: ${config.webOrigins[0]}/initiative/${encodeURIComponent(initiative.slug)}`,
        `Type: ${initiative.type === "rfp" ? "RFP" : "Grant"}`,
        `Funding Goal: ${usd(initiative.goalUsd)}`,
        `Safe Address: ${initiative.safeAddress || "Not deployed"}`,
        "",
        `Pledge Amount: ${usd(amount)}`,
        `Pledge Org: ${org}`,
        `Pledge Contact Email: ${email}`,
        `Who are we talking with?: ${contact}`,
      );
    } else if (
      ["initiativeId", "pledgeAmount", "pledgeOrg", "pledgeContact"].some((key) =>
        body[key] !== undefined
      )
    ) {
      throw new HttpError(400, "pledge details are only supported for pledge requests");
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
    // The comment screen's model, as a tag only: every message is still sent.
    // Its own share of the daily AI budget, so comment moderation keeps the rest.
    const screen = message
      ? await deps.ai.screenSupport(
        SUPPORT_CATEGORIES[category],
        message,
        () => db.meta.aiSupportBudgetOk(),
      )
      : null;
    if (screen?.error) deps.log(`AI screen failed on a support message: ${screen.error}`);
    const unknownDomains = [
      ...new Set(commentLinks(message).filter((l) => !l.known).map((l) => l.domain || "?")),
    ];
    const header = [
      `[${SITE_TAG} · ${SUPPORT_CATEGORIES[category]}${
        screen?.verdict === "spam" ? " · SPAM" : ""
      }]`,
      ...(screen ? [supportScreenLine(screen)] : []),
      ...(unknownDomains.length ? [`Unknown link domains: ${unknownDomains.join(", ")}`] : []),
      ...(receipt ? [`Transaction: ${transactionUrl}`] : []),
      ...pledgeInfo,
      ...(pageUrl ? [`Page: ${pageUrl}`] : []),
    ];
    const text = header.join("\n") + "\n\n" +
      (pledge ? `Message: ${message}` : message || "Please send a receipt for this donation.");
    let res: Response;
    try {
      res = await deps.fetch(config.supportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: contact,
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
