/**
 * The site is a client-rendered SPA, so the served HTML carries no initiative
 * text. For the board and each approved initiative page this adds, on the
 * server: a canonical link, alternates to the Markdown and JSON feeds,
 * schema.org JSON-LD, and the text and funding numbers in a <noscript> block
 * (outside the React root, so hydration never sees it).
 */
import type { Feed, FeedInitiative } from "./feed.ts";
import { entryMarkdown } from "./feed.ts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON inside <script>: nothing that closes the tag or opens a comment. */
const ldJson = (v: unknown) =>
  `<script type="application/ld+json">${
    JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
  }</script>`;

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function inject(html: string, head: string, body: string, title?: string): string {
  let out = html;
  if (title) {
    const tag = `<title>${esc(title)}</title>`;
    out = /<title>[\s\S]*?<\/title>/.test(out)
      ? out.replace(/<title>[\s\S]*?<\/title>/, tag)
      : out.replace("</head>", tag + "</head>");
  }
  out = out.includes("</head>") ? out.replace("</head>", head + "</head>") : head + out;
  return out.includes("</body>") ? out.replace("</body>", body + "</body>") : out + body;
}

export function projectJsonLd(x: FeedInitiative) {
  return {
    "@context": "https://schema.org",
    "@type": "Project",
    name: x.title,
    description: x.summary,
    url: x.url,
    keywords: x.categories.map((c) => c.label).join(", "),
    ...(x.pledges.length
      ? { funder: x.pledges.map((p) => ({ "@type": "Organization", name: p.company })) }
      : {}),
    ...(x.donate
      ? {
        potentialAction: {
          "@type": "DonateAction",
          name: `Donate to ${x.title}`,
          description:
            `Send ETH or a supported stablecoin to the initiative's Safe ${x.donate.safeAddress} on ${x.donate.chain} (chain ${x.donate.chainId}).`,
          target: { "@type": "EntryPoint", urlTemplate: x.url },
          recipient: {
            "@type": "Organization",
            name: x.recipientTeam ?? x.title,
            identifier: x.donate.safeAddress,
          },
        },
      }
      : {}),
  };
}

/** The board page. */
export function boardSeo(html: string, feed: Feed, origin: string): string {
  // The prerendered board already carries its canonical link and description.
  const head = [
    `<link rel="alternate" type="text/plain" title="llms.txt" href="${esc(origin)}/llms.txt">`,
    `<link rel="alternate" type="text/plain" title="All initiatives, full text" href="${
      esc(origin)
    }/llms-full.txt">`,
    `<link rel="alternate" type="application/json" title="initiatives.json" href="${
      esc(origin)
    }/api/initiatives.json">`,
    ldJson({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "TheDAO Security Fund initiatives",
      numberOfItems: feed.count,
      itemListElement: feed.initiatives.map((x, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: x.url,
        name: x.title,
      })),
    }),
  ].join("");
  const body =
    `<noscript><section><h1>Security initiatives looking for funding</h1><p>${feed.count} approved initiatives, ${
      usd(feed.totals.raisedUsd)
    } raised of ${
      usd(feed.totals.goalUsd)
    }. Full text: <a href="/llms-full.txt">llms-full.txt</a>.</p><ul>${
      feed.initiatives.map((x) =>
        `<li><a href="${esc(x.url)}">${esc(x.title)}</a>: ${x.type === "grant" ? "Grant" : "RFP"}${
          x.categories.length ? ", " + esc(x.categories.map((c) => c.label).join(", ")) : ""
        }, ${usd(x.raisedUsd)} of ${usd(x.goalUsd)} (${x.pctFunded}%). ${esc(x.summary)}</li>`
      ).join("")
    }</ul></section></noscript>`;
  return inject(html, head, body);
}

/** An approved initiative's page. */
export function initiativeSeo(html: string, x: FeedInitiative): string {
  const head = [
    `<link rel="canonical" href="${esc(x.url)}">`,
    `<link rel="alternate" type="text/markdown" href="${esc(x.markdownUrl)}">`,
    `<meta name="description" content="${esc(x.summary.slice(0, 300))}">`,
    ldJson(projectJsonLd(x)),
  ].join("");
  const body = `<noscript><article><pre style="white-space:pre-wrap">${
    esc(entryMarkdown(x))
  }</pre></article></noscript>`;
  return inject(html, head, body, `${x.title} · TheDAO Security Fund`);
}
