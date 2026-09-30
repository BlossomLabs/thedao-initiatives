import { readFileSync } from "node:fs";
import { headingKey, SECTIONS } from "./sections.ts";
import { rowFromHeading } from "./milestones.ts";

const guide = readFileSync("public/submit.md", "utf8");

test("every heading in the guide's RFP field list maps through the alias map, in form order", () => {
  const block = /An RFP, in this order[\s\S]*?```([\s\S]*?)```/.exec(guide) ??
    /```markdown\n([\s\S]*?)```/.exec(guide);
  expect(block).toBeTruthy();
  const heads = [...block![1].matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  expect(heads.length).toBeGreaterThan(8);
  const keys = heads.map((h) => headingKey(h, "rfp"));
  expect(keys.every(Boolean)).toBe(true);
  const sections = keys.filter((k) => (SECTIONS.rfp as string[]).includes(k as string));
  expect(sections).toEqual(SECTIONS.rfp);
});

test("the grant-only headings and the milestone syntax are in the guide", () => {
  for (
    const h of [
      "## Recipient team",
      "## The team",
      "## Why a grant: what already exists",
      "## Commitments",
    ]
  ) {
    expect(guide).toContain(h);
  }
  const line = /^### .+ - \$[\d,]+.*$/m.exec(guide)![0].slice(4);
  expect(rowFromHeading(line).amount).toBeGreaterThan(0);
});
