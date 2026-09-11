import {
  milestonesToMd,
  parseMilestones,
  renderMilestonesMd,
  rowFromHeading,
} from "./milestones.ts";
import { stripInlineHeadings } from "./sections.ts";

test("headings: adoption, done, amounts, legacy letters", () => {
  expect(rowFromHeading("Agreed standard - $50,000 (adoption)")).toMatchObject({
    name: "Agreed standard",
    amount: 50000,
    adoption: true,
    done: false,
  });
  expect(rowFromHeading("Infra - $13,000 (adoption milestone) (done)")).toMatchObject({
    name: "Infra",
    amount: 13000,
    adoption: true,
    done: true,
  });
  expect(rowFromHeading("A - Name - $x - $1,000")).toMatchObject({
    name: "Name - $x",
    amount: 1000,
  });
  expect(rowFromHeading("Just a name")).toMatchObject({ name: "Just a name", amount: 0 });
  expect(rowFromHeading("Yul - $85,500 (target: March 2027)")).toMatchObject({ amount: 85500 });
});

test("top-up lines: target month, delivered, criteria prefixes", () => {
  const { rows, preamble } = parseMilestones([
    "intro",
    "### Infra - $13,000 (done)",
    "",
    "Delivered: <https://example.org/pr/1>",
    "- [x] tests in CI",
    "### Yul - $33,000",
    "Target month: 2026-10",
    "2) round trips",
  ]);
  expect(preamble).toBe("intro");
  expect(rows[0]).toMatchObject({
    done: true,
    link: "https://example.org/pr/1",
    criteria: ["tests in CI"],
  });
  expect(rows[1]).toMatchObject({ month: "2026-10", criteria: ["round trips"] });
});

test("edit format round-trips and the page format letters rows", () => {
  const rows = parseMilestones([
    "### Agreed standard - $50,000",
    "- At least 6 firms sign",
    "### Adoption evidence - $75,000 (adoption)",
    "Target month: 2027-03",
    "- 20 teams rated",
  ]).rows;
  const md = milestonesToMd(rows);
  expect(md).toContain("### Adoption evidence - $75,000 (adoption)");
  expect(md).toContain("Target month: 2027-03");
  expect(parseMilestones(md.split("\n")).rows).toEqual(rows);
  const page = renderMilestonesMd(rows, false);
  expect(page).toContain("### A - Agreed standard - $50,000");
  expect(page).toContain("### B - Adoption evidence - $75,000 (adoption milestone)");
  expect(page).toContain("- [ ] 20 teams rated");
  expect(page).not.toContain("Target month");
  const topup = renderMilestonesMd([{ ...rows[0], done: true, link: "https://x.org/1" }], true);
  expect(topup).toContain("(done)");
  expect(topup).toContain("- [x] At least 6 firms sign");
  expect(topup).toContain("Delivered: <https://x.org/1>");
});

test("inline headings become bold", () => {
  expect(stripInlineHeadings("## x\n\ntext\n### y")).toBe("**x**\n\ntext\n**y**");
});
