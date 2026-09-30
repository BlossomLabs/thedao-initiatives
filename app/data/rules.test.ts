import { readFileSync } from "node:fs";
import { parseRulesFile, RULES, rulesKindFor } from "./rules";

test("rules file: version line, then the title heading, then the body", () => {
  const p = parseRulesFile("rfp", "version: 2026-09\n# How RFPs work\n\n1. First.\n2. Second.\n");
  expect(p).toEqual({
    kind: "rfp",
    title: "How RFPs work",
    version: "2026-09",
    body: "1. First.\n2. Second.",
  });
  expect(() => parseRulesFile("rfp", "# no version\n")).toThrow();
  expect(() => parseRulesFile("rfp", "version: 1\nno heading\n")).toThrow();
  expect(() => parseRulesFile("rfp", "version: 1\n# Title\n\n")).toThrow();
});

test("the bundled panels are the repo's content/boilerplate files", () => {
  for (const kind of ["rfp", "grant", "topup"] as const) {
    const file = readFileSync(`content/boilerplate/${kind}.md`, "utf8");
    expect(RULES[kind]).toEqual(parseRulesFile(kind, file));
    expect(RULES[kind].version).toMatch(/^\d{4}-\d{2}/);
    expect(RULES[kind].body).not.toMatch(/^#/m);
  }
  expect(RULES.rfp.title).toBe("How RFPs work");
  expect(RULES.grant.title).toBe("How grants work");
  expect(RULES.topup.title).toMatch(/^How top-up grants work/);
});

test("panel choice: top-up beats grant, everything else is an RFP", () => {
  expect(rulesKindFor({ type: "rfp", topup: false })).toBe("rfp");
  expect(rulesKindFor({ type: "grant", topup: false })).toBe("grant");
  expect(rulesKindFor({ type: "grant", topup: true })).toBe("topup");
});

test.each(["rfp", "grant", "topup"] as const)(
  "the AI guide's %s process rules match the website",
  (kind) => {
    const guide = readFileSync("public/submit.md", "utf8").replace(/\r\n/g, "\n");
    const panel = RULES[kind];
    const section = guide.split(/^#{1,3} /m).find((block) => block.startsWith(`${panel.title}\n`));
    expect(section?.slice(panel.title.length).trim()).toBe(panel.body);
  },
);
