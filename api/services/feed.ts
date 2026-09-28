/**
 * The public, agent-readable view of the board: one builder, one field
 * allowlist, every output (llms.txt, llms-full.txt, initiatives.json, the
 * sitemap, the page heads) rendered from it. Approved initiatives only; no
 * revisions, comments, contacts, funder leads, donor wallets or admin fields.
 */
import type { Deps } from "../middleware/context.ts";
import type { Initiative, Pledge } from "../db/types.ts";
import type { Card } from "../routes/board.ts";
import { CHAIN_ID, NATIVE_ETH, TOKENS } from "../config.ts";
import { FIELDS, milestonesToMd, SECTIONS } from "../../shared/draft/mod.ts";
import { categoriesOf, categoryOf } from "../../shared/categories.ts";
import { pickText } from "../db/initiatives.ts";

export const FEED_SCHEMA_VERSION = 1;

const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString() : null);

export interface FeedInitiative {
  slug: string;
  url: string;
  markdownUrl: string;
  title: string;
  type: "rfp" | "grant";
  categories: { slug: string; label: string }[];
  status: "open" | "funded";
  summary: string;
  goalUsd: number;
  raisedUsd: number;
  pctFunded: number;
  backers: number;
  recipientTeam: string | null;
  recipientUrl: string | null;
  durationMonths: number | null;
  approvedAt: string | null;
  createdAt: string | null;
  donate: {
    safeAddress: string;
    chainId: number;
    chain: string;
    tokens: { symbol: string; address: string | null; decimals: number }[];
    enabled: boolean;
  } | null;
  pledges: { company: string; amountUsd: number; status: "pledged" | "received" }[];
  /** Markdown, one entry per section in page order. */
  sections: { key: string; heading: string; markdown: string }[];
  milestones: {
    name: string;
    amountUsd: number;
    adoption: boolean;
    done: boolean;
    targetMonth: string | null;
    criteria: string[];
  }[];
  links: string[];
  /** Legacy rows keep one markdown body instead of sections. */
  details: string | null;
}

export interface Feed {
  schemaVersion: number;
  generatedAt: string;
  count: number;
  totals: { goalUsd: number; raisedUsd: number; backers: number; rfps: number; grants: number };
  initiatives: FeedInitiative[];
}

const TOKEN_LIST = [
  ...(NATIVE_ETH ? [{ symbol: "ETH", address: null, decimals: 18 }] : []),
  ...Object.entries(TOKENS).map(([symbol, [address, decimals]]) => ({ symbol, address, decimals })),
];

export function feedInitiative(
  origin: string,
  r: Initiative,
  card: Card,
  pledges: Pledge[],
): FeedInitiative {
  const t = pickText(r);
  const structured = Object.keys(t.sections).length > 0 || t.milestones.length > 0;
  return {
    slug: r.slug,
    url: `${origin}/initiative/${r.slug}`,
    markdownUrl: `${origin}/initiative/${r.slug}.md`,
    title: r.title,
    type: r.type,
    categories: categoriesOf(r).map((s) => ({ slug: s, label: categoryOf(s)!.label })),
    status: card.funded ? "funded" : "open",
    summary: r.summary,
    goalUsd: r.goalUsd,
    raisedUsd: Math.round(card.summary.total * 100) / 100,
    pctFunded: card.pct,
    backers: card.backers,
    recipientTeam: r.type === "grant" && r.recipientTeam ? r.recipientTeam : null,
    recipientUrl: r.type === "grant" && r.recipientUrl ? r.recipientUrl : null,
    durationMonths: r.durationMonths ?? null,
    approvedAt: iso(r.approvedAt),
    createdAt: iso(r.createdAt),
    donate: r.safeAddress
      ? {
        safeAddress: r.safeAddress,
        chainId: CHAIN_ID,
        chain: "Ethereum mainnet",
        tokens: TOKEN_LIST,
        enabled: card.donationsEnabled,
      }
      : null,
    pledges: pledges
      .filter((p) => p.company && (p.status === "pledged" || p.status === "received"))
      .map((p) => ({
        company: p.company,
        amountUsd: p.amountUsd,
        status: p.status as "pledged" | "received",
      })),
    sections: SECTIONS[r.type]
      .map((key) => ({
        key,
        heading: FIELDS[key].heading,
        markdown: (t.sections[key] ?? "").trim(),
      }))
      .filter((s) => s.markdown),
    milestones: t.milestones.map((m) => ({
      name: m.name,
      amountUsd: m.amount,
      adoption: Boolean(m.adoption),
      done: Boolean(m.done),
      targetMonth: m.month || null,
      criteria: m.criteria,
    })),
    links: t.links,
    details: structured ? null : t.details.trim() || null,
  };
}

/** The feed from the board's cards (already in Recommended order). */
export async function buildFeed(
  deps: Pick<Deps, "db" | "now">,
  origin: string,
  cards: Card[],
): Promise<Feed> {
  const approved = await deps.db.initiatives.list(["approved"]);
  const byId = new Map(approved.map((r) => [r.id, r]));
  const initiatives: FeedInitiative[] = [];
  for (const card of cards) {
    const r = byId.get(card.initiative.id);
    if (!r) continue;
    initiatives.push(feedInitiative(origin, r, card, await deps.db.pledges.list(r.id)));
  }
  return {
    schemaVersion: FEED_SCHEMA_VERSION,
    generatedAt: new Date(deps.now() * 1000).toISOString(),
    count: initiatives.length,
    totals: {
      goalUsd: initiatives.reduce((n, x) => n + x.goalUsd, 0),
      raisedUsd: Math.round(initiatives.reduce((n, x) => n + x.raisedUsd, 0) * 100) / 100,
      backers: initiatives.reduce((n, x) => n + x.backers, 0),
      rfps: initiatives.filter((x) => x.type === "rfp").length,
      grants: initiatives.filter((x) => x.type === "grant").length,
    },
    initiatives,
  };
}

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const typeName = (t: string) => (t === "grant" ? "Grant" : "RFP");

/** The facts block every markdown output shares. */
function factLines(x: FeedInitiative): string[] {
  const lines = [
    `- Type: ${typeName(x.type)}`,
    `- Categories: ${x.categories.map((c) => c.label).join(", ") || "none yet"}`,
    `- Status: ${x.status === "funded" ? "Fully funded" : "Open for funding"}`,
    `- Goal: ${usd(x.goalUsd)}`,
    `- Raised: ${usd(x.raisedUsd)} (${x.pctFunded}% funded) from ${x.backers} backer${
      x.backers === 1 ? "" : "s"
    }`,
  ];
  if (x.recipientTeam) lines.push(`- Recipient team: ${x.recipientTeam}`);
  if (x.durationMonths) lines.push(`- Duration: ${x.durationMonths} months from funding`);
  if (x.donate) {
    lines.push(
      `- Donate: Safe ${x.donate.safeAddress} on ${x.donate.chain} (chain ${x.donate.chainId}), ` +
        `tokens ${x.donate.tokens.map((t) => t.symbol).join(", ")}`,
    );
  }
  if (x.pledges.length) {
    lines.push(
      `- Pledged by: ${
        x.pledges.map((p) =>
          `${p.company} (${usd(p.amountUsd)}${p.status === "received" ? ", received" : ""})`
        )
          .join("; ")
      }`,
    );
  }
  lines.push(`- Page: ${x.url}`);
  return lines;
}

/** One initiative for llms-full.txt: `## Title`, the facts, then its text one level down. */
export function entryMarkdown(x: FeedInitiative): string {
  const out = [`## ${x.title}`, "", ...factLines(x), "", x.summary.trim(), ""];
  for (const s of x.sections) out.push(`### ${s.heading}`, "", demote(s.markdown), "");
  if (x.details) out.push(demote(x.details), "");
  if (x.milestones.length) {
    out.push(
      "### Milestones",
      "",
      milestonesToMd(x.milestones.map((m) => ({
        name: m.name,
        amount: m.amountUsd,
        adoption: m.adoption,
        done: m.done,
        link: "",
        month: m.targetMonth ?? "",
        criteria: m.criteria,
      }))).replace(/^### /gm, "#### "),
      "",
    );
  }
  if (x.links.length) out.push("### Links", "", ...x.links.map((l) => `- ${l}`), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Headings inside an answer move down two levels so they nest under the entry. */
const demote = (md: string) => md.replace(/^(#{1,4}) /gm, (_, h: string) => `${h}## `);

/** The front-matter lines the public .md adds to the content-file shape (ignored by the sync). */
export function feedFrontMatter(x: FeedInitiative): string[] {
  const lines = [
    `url: ${x.url}`,
    `categories: ${x.categories.map((c) => c.slug).join(", ")}`,
    `funding_status: ${x.status}`,
    `raised: ${x.raisedUsd}`,
    `funded_pct: ${x.pctFunded}`,
    `backer_count: ${x.backers}`,
  ];
  if (x.donate) lines.push(`safe: ${x.donate.safeAddress}`, `chain_id: ${x.donate.chainId}`);
  return lines;
}

export function llmsIndex(feed: Feed, origin: string): string {
  const t = feed.totals;
  const out = [
    "# TheDAO Security Fund Initiatives",
    "",
    `> ${feed.count} approved Ethereum security initiatives (${t.rfps} RFPs, ${t.grants} grants) ` +
    `looking for funding: ${usd(t.raisedUsd)} raised of ${
      usd(t.goalUsd)
    } asked, from ${t.backers} backers. ` +
    "Every donation goes to that initiative's own Safe on Ethereum mainnet and is paid out to the team only as milestones are accepted.",
    "",
    "To evaluate an initiative, read its full text: who ends up safer and from what attack, what gets built, " +
    "and the adoption milestone that proves outside parties use it. Compare the goal with the impact and " +
    "with what is already raised. To back one, donate to its Safe from any wallet or exchange (the Safe address, " +
    "chain and accepted tokens are in each entry), or pledge on its page. Read the donation terms first.",
    "",
    "## Data",
    "",
    `- [All initiatives, full text](${origin}/llms-full.txt): every approved initiative in one Markdown file, Recommended order`,
    `- [initiatives.json](${origin}/api/initiatives.json): the same data as JSON, filterable with ?type=rfp|grant, ?cat=<slug>, ?status=open|funded`,
    `- [JSON Schema](${origin}/api/initiatives.schema.json): the schema of initiatives.json`,
    `- [Board API](${origin}/api/board): the live board cards the site renders`,
    "",
    "## Initiatives",
    "",
    ...feed.initiatives.map((x) =>
      `- [${x.title}](${x.markdownUrl}): ${typeName(x.type)}, ${
        x.categories[0]?.label ?? "uncategorized"
      }, ${x.pctFunded}% funded of ${usd(x.goalUsd)}`
    ),
    "",
    "## Support",
    "",
    `- [The board](${origin}/): donate or pledge from any initiative's page`,
    `- [Donation terms](${origin}/donation-terms): what a donation is and how unspent funds are handled`,
    "",
    "## Rules",
    "",
    `- [Drafting guide](${origin}/submit.md): the guide for proposing a new initiative, including the round rules`,
    `- [Suggest an initiative](${origin}/submit): where a finished draft is submitted`,
    "",
    "## Optional",
    "",
    `- [Sitemap](${origin}/sitemap.xml)`,
    "",
  ];
  return out.join("\n");
}

export function llmsFull(feed: Feed, origin: string): string {
  return [
    "# TheDAO Security Fund Initiatives: full text",
    "",
    `> ${feed.count} approved initiatives, Recommended order, generated ${feed.generatedAt}. Index: ${origin}/llms.txt`,
    "",
    ...feed.initiatives.map(entryMarkdown),
  ].join("\n");
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sitemap(feed: Feed, origin: string): string {
  const urls = [
    { loc: `${origin}/`, lastmod: null as string | null },
    { loc: `${origin}/submit`, lastmod: null },
    { loc: `${origin}/donation-terms`, lastmod: null },
    ...feed.initiatives.map((x) => ({ loc: x.url, lastmod: x.approvedAt })),
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) =>
      `  <url><loc>${xmlEscape(u.loc)}</loc>${
        u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ""
      }</url>`
    ).join("\n") + "\n</urlset>\n";
}

/** initiatives.json filters: ?type=rfp|grant, ?cat=<slug>[,<slug>] (any), ?status=open|funded. */
export function filterFeed(feed: Feed, q: { type?: string; cat?: string; status?: string }): Feed {
  const cats = (q.cat ?? "").split(",").filter(Boolean);
  const initiatives = feed.initiatives.filter((x) =>
    (!q.type || x.type === q.type) &&
    (!q.status || x.status === q.status) &&
    (!cats.length || x.categories.some((c) => cats.includes(c.slug)))
  );
  return { ...feed, count: initiatives.length, initiatives };
}
