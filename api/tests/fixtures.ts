/** Structured fixtures: the smallest submission that passes every rule, the
 * guide's example document as a payload, and content files that sync. */
import { SECTIONS, splitDraft } from "../../shared/draft/mod.ts";

export type FixtureType = "rfp" | "grant";

/** Every section of the type answered, one adoption milestone worth the
 * whole goal, the page facts filled: what `POST /api/initiatives` needs. */
export function minimalSubmission(goal: number, type: FixtureType = "rfp") {
  const sections = Object.fromEntries(
    SECTIONS[type].map((
      k,
    ) => [k, k === "why" ? `Answered for a ${type} at ${goal}.` : "Answered."]),
  );
  return {
    title: "A proper initiative title",
    summary: "This summary is comfortably longer than the forty character minimum required.",
    type,
    goal: String(goal),
    durationMonths: "6",
    ...(type === "grant" ? { recipientTeam: "Team X", recipientUrl: "https://x.example/" } : {}),
    sections,
    milestones: [{
      name: "Ship it",
      amount: goal,
      adoption: true,
      done: false,
      link: "",
      month: "",
      criteria: ["Merged."],
    }],
    links: [] as string[],
    backers: [] as Record<string, unknown>[],
    funders: "Some L2 and a wallet company",
    contact: "me@example.com",
    categories: ["audits-analysis"],
  };
}

/** The text-only payload sent by the proposer editor, without submission fields. */
export function revisionBody(draft: ReturnType<typeof minimalSubmission>) {
  const { title, summary, sections, milestones, links } = draft;
  return { title, summary, sections, milestones, links };
}

/** docs/llms-v3-example-output.md (the guide's worked example) as the JSON
 * the form would post after the paste box sorted it. */
export async function exampleSubmission() {
  const text = await Deno.readTextFile(
    new URL("../../docs/llms-v3-example-output.md", import.meta.url),
  );
  const r = splitDraft(text, "rfp");
  return {
    title: r.page.title ?? "",
    summary: r.page.summary ?? "",
    type: "rfp" as const,
    goal: r.page.goal ?? "",
    durationMonths: r.page.duration ?? "",
    links: (r.page.links ?? "").split("\n").filter(Boolean),
    sections: r.fields,
    milestones: r.milestones,
    backers: [] as Record<string, unknown>[],
    funders: r.page.funders ?? "",
    contact: r.page.contact ?? "",
    categories: ["opsec", "audits-analysis"],
  };
}

const RFP_BODY = (goal: number) =>
  `## Why this matters

Because it closes a gap.

## In scope

Things get built.

## Out of scope

Other things.

## Existing work

None.

## Who we expect to do this

Anyone credible.

## Hard requirements

1. Ship it under an open license.

## Milestones

### Build - $${(goal / 3).toLocaleString("en-US")}

- Merged.

### Adopt - $${(goal - goal / 3).toLocaleString("en-US")} (adoption)

- Used by three teams.

## Links

https://example.org/
`;

const GRANT_BODY = (goal: number, topup = false) =>
  `## Why this matters

Because it closes a gap.

## The team

Two people who did this before.

## Why a grant: what already exists

A prototype at https://y.example/.

## In scope

Finish the prototype.

## Out of scope

A rewrite.

## Commitments

MIT license, two years of maintenance.

## Milestones

### First half - $${(goal / 2).toLocaleString("en-US")}${topup ? " (done)" : ""}
${topup ? "Delivered: https://y.example/v1\n" : ""}
- Released.

### Adoption - $${(goal / 2).toLocaleString("en-US")} (adoption)
${topup ? "Target month: 2027-03\n" : ""}
- Three integrations live.
`;

/** Three content files with the guide's headings: an RFP, a grant, a top-up. */
export function syntheticContentFiles(): { name: string; text: string }[] {
  return [
    {
      name: "synthetic-rfp.md",
      text: "---\ntitle: Synthetic RFP one\n" +
        "summary: A synthetic RFP that syncs cleanly through the strict content parser.\n" +
        "goal: 600000\nduration: 12\n---\n" + RFP_BODY(600_000),
    },
    {
      name: "synthetic-grant.md",
      text: "---\ntitle: Synthetic grant one\n" +
        "summary: A synthetic grant that syncs cleanly through the strict content parser.\n" +
        "goal: 300000\ntype: grant\nduration: 6\nrecipient: Team Y\n" +
        "recipient_url: https://y.example/\n---\n" + GRANT_BODY(300_000),
    },
    {
      name: "synthetic-topup.md",
      text: "---\ntitle: Synthetic top-up one\n" +
        "summary: A synthetic top-up grant that syncs cleanly through the strict parser.\n" +
        "goal: 100000\ntype: grant\ntopup: true\nreviewer: Nicholas Example\n" +
        "recipient: Team Z\n---\n" + GRANT_BODY(100_000, true),
    },
  ];
}

/** A structured grant body for ad-hoc content files in tests. */
export const grantBody = GRANT_BODY;
export const rfpBody = RFP_BODY;
