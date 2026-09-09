import { Hono } from "hono";
import type { Deps, Vars } from "../middleware/context.ts";
import { HttpError } from "../lib/errors.ts";
import { jsonBody, s } from "../lib/body.ts";
import { donationJson, pledgeJson, publicRfp } from "../lib/json.ts";
import { parseGoal, validateForumUrl } from "../lib/validate.ts";
import { pctOf } from "./board.ts";
import type { Config } from "../config.ts";
import {
  MAX_DETAILS,
  MAX_FUNDERS,
  MAX_SUMMARY,
  MAX_TITLE,
  SUBMISSIONS_PER_HOUR_PER_IP,
  TOKENS,
} from "../config.ts";

export const decimalsOf = (sym: string): number | undefined => TOKENS[sym]?.[1];

/** Card-checkout URL template ("{AMT}" = dollar amount) delivering USDC to a Safe. */
export function onrampLink(
  config: Config,
  safeAddress: string,
): { url: string; prefilled: boolean } {
  const { onrampProvider: p, onrampApiKey: key } = config;
  if (p === "transak" && key) {
    return {
      url: `https://global.transak.com/?apiKey=${
        encodeURIComponent(key)
      }&cryptoCurrencyCode=USDC&network=ethereum&fiatCurrency=USD&defaultFiatAmount={AMT}&walletAddress=${safeAddress}`,
      prefilled: true,
    };
  }
  if (p === "moonpay" && key) {
    return {
      url: `https://buy.moonpay.com/?apiKey=${
        encodeURIComponent(key)
      }&currencyCode=usdc&baseCurrencyCode=usd&baseCurrencyAmount={AMT}&walletAddress=${safeAddress}`,
      prefilled: true,
    };
  }
  return { url: "", prefilled: false };
}

export function initiativeRoutes(deps: Deps) {
  const r = new Hono<Vars>();
  const { db, config } = deps;

  r.get("/:slug", async (c) => {
    const rfp = await db.rfps.bySlug(c.req.param("slug"));
    if (!rfp || !["approved", "archived"].includes(rfp.status)) {
      throw new HttpError(404, "not found");
    }
    const [summary, pledges, donations, active] = await Promise.all([
      db.fundingSummary(rfp.id),
      db.pledges.list(rfp.id),
      db.donations.list(rfp.id),
      deps.chain.activeTokens(),
    ]);
    return c.json({
      initiative: publicRfp(rfp),
      summary,
      pct: pctOf(summary.total, rfp.goalUsd),
      pledges: pledges.map((p) => pledgeJson(config, p)),
      donations: donations.map((d) => donationJson(d, decimalsOf)),
      funded: Boolean(rfp.goalUsd && summary.total >= rfp.goalUsd),
      donationsEnabled: Boolean(
        Object.keys(active).length && rfp.safeAddress && rfp.status === "approved",
      ),
      onramp: rfp.safeAddress
        ? onrampLink(config, rfp.safeAddress)
        : { url: "", prefilled: false },
    });
  });

  /** Public submission; always lands as pending for admin review. */
  r.post("/", async (c) => {
    const body = await jsonBody(c);
    if (s(body.website)) throw new HttpError(400, "bad request"); // honeypot
    if (!(await db.rateLimit("submit:" + c.var.ip, SUBMISSIONS_PER_HOUR_PER_IP, 3600))) {
      throw new HttpError(
        429,
        "Too many submissions from your address; try again in an hour.",
      );
    }
    let discourseUrl = "";
    if (s(body.discourseUrl)) {
      const [clean, err] = await validateForumUrl(body.discourseUrl);
      if (err) throw new HttpError(400, err);
      discourseUrl = clean!;
    }
    const title = s(body.title, MAX_TITLE);
    if (title.length < 8) {
      throw new HttpError(
        400,
        "Please give the initiative a title (at least 8 characters).",
      );
    }
    const summary = s(body.summary, MAX_SUMMARY);
    if (summary.length < 40) {
      throw new HttpError(
        400,
        "Please describe the initiative in at least 40 characters.",
      );
    }
    const [goal, gerr] = parseGoal(body.goal);
    if (gerr) throw new HttpError(400, gerr);
    // NEVER rendered publicly: private fundraising leads, admin-only like contact.
    const funders = s(body.funders, MAX_FUNDERS);
    if (funders.length < 10) {
      throw new HttpError(
        400,
        "Please list who is likely to fund this (at least one funder line).",
      );
    }
    const type = body.type === "grant" ? "grant" : "rfp";
    const rfp = await db.rfps.insert({
      title,
      summary,
      discourseUrl,
      goalUsd: goal!,
      contact: s(body.contact, 200),
      details: s(body.details, MAX_DETAILS),
      type,
      funders,
      status: "pending",
    });
    return c.json({ slug: rfp.slug, status: rfp.status }, 201);
  });

  return r;
}
