import { readFileSync } from "node:fs";
import { parseBackers, splitDraft } from "./splitter.ts";
import { checkSubmission } from "./checks.ts";
import { headingKey, SECTIONS } from "./sections.ts";
import { parseAmount } from "./amount.ts";

export const EXAMPLE = readFileSync("docs/llms-v3-example-output.md", "utf8");

test("the gold-standard example sorts with nothing unsorted", () => {
  const r = splitDraft(EXAMPLE, "rfp");
  expect(r.unsorted).toBe("");
  for (const k of SECTIONS.rfp) expect(r.fields[k]).toBeTruthy();
  expect(Object.keys(r.fields).sort()).toEqual([...SECTIONS.rfp].sort());
  expect(r.page.title).toMatch(/^OPSEC Ratings Coalition/);
  expect(parseAmount(r.page.goal)).toBe(150000);
  expect(r.page.duration).toBe("18");
  expect(r.page.links).toContain("https://frameworks.securityalliance.org/");
  expect(r.page.funders).toBeTruthy();
  expect(r.page.contact).toBeTruthy();
  expect(r.milestones.map((m) => m.amount)).toEqual([50000, 25000, 75000]);
  expect(r.milestones.map((m) => m.adoption)).toEqual([false, false, true]);
  expect(r.milestones[0].criteria.length).toBe(3);
});

test("the example passes the checks with zero errors and zero warnings", () => {
  const r = splitDraft(EXAMPLE, "rfp");
  const f = checkSubmission({
    type: "rfp",
    topup: false,
    page: {
      title: r.page.title!,
      summary: r.page.summary!,
      goal: parseAmount(r.page.goal),
      duration: r.page.duration!,
      recipient: "",
      funders: r.page.funders!,
      contact: r.page.contact!,
    },
    sections: r.fields,
    milestones: r.milestones,
    links: r.page.links!.split("\n"),
    backers: [],
  });
  expect(f.errors).toEqual([]);
  expect(f.warnings).toEqual([]);
});

test("old format: title prefix, letters, inline headings, preamble", () => {
  const doc = [
    "# Grant: A thing",
    "## Why this matters",
    "Because.",
    "### Sub heading",
    "more",
    "## Milestones (draft)",
    "Some preamble line.",
    "### A - First - $10,000",
    "- [ ] one",
    "### B - Second - $20,000 (adoption)",
    "1. two",
  ].join("\n");
  const r = splitDraft(doc, "grant");
  expect(r.page.title).toBe("A thing");
  expect(r.fields.why).toBe("Because.\n**Sub heading**\nmore");
  expect(r.milestones.map((m) => m.name)).toEqual(["First", "Second"]);
  expect(r.milestones[1].adoption).toBe(true);
  expect(r.milestones[0].criteria).toEqual(["one"]);
  expect(r.milestones[1].criteria).toEqual(["two"]);
  expect(r.unsorted).toBe("Some preamble line.");
});

test("type-dependent aliases and a second section for the same key", () => {
  expect(headingKey("What already exists", "grant")).toBe("why_grant");
  expect(headingKey("What already exists", "rfp")).toBe("existing");
  expect(headingKey("The recipient", "grant")).toBe("team");
  expect(headingKey("The recipient:", "rfp")).toBe("who");
  expect(headingKey("**In scope**", "rfp")).toBe("in_scope");
  const r = splitDraft("## In scope\nA\n## What this actually pays for\nB\n", "rfp");
  expect(r.fields.in_scope).toBe("A\n\n**What this actually pays for**\nB");
});

test("unknown headings land in unsorted until the next known one", () => {
  const r = splitDraft("## Why this matters\nA\n## Random\nlost\n## In scope\nB", "rfp");
  expect(r.fields.why).toBe("A");
  expect(r.fields.in_scope).toBe("B");
  expect(r.unsorted).toBe("## Random\nlost");
});

test("backer lines, with an optional logo file as the 4th field", () => {
  expect(
    parseBackers("- Argot | $20,000 | https://argot.org | argot.png\nno pipe here\nOrg2 | 5.000"),
  ).toEqual([
    { org: "Argot", amountUsd: 20000, url: "https://argot.org", logo: "argot.png" },
    { org: "Org2", amountUsd: 5000, url: "", logo: "" },
  ]);
});
