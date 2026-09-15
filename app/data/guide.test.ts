import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAmount, SECTIONS } from "@shared/draft/mod";
import {
  EXAMPLE_MILESTONES,
  EXAMPLE_PAGE,
  exampleFor,
  EXAMPLES,
  GUIDE_TEXT,
  markdownBlocks,
} from "./guide";

describe("guide", () => {
  it("bundles the repo-root llms.txt", () => {
    expect(GUIDE_TEXT).toBe(readFileSync("llms.txt", "utf8"));
    expect(markdownBlocks(GUIDE_TEXT)).toHaveLength(2);
  });

  it("has an example for every section of both types", () => {
    const keys = new Set([...SECTIONS.rfp, ...SECTIONS.grant]);
    for (const key of keys) {
      expect(EXAMPLES[key], key).toBeTruthy();
      expect(exampleFor(key).fallback, key).toBe(false);
    }
    expect(EXAMPLES.why).toMatch(/^Your keys, your devices/);
    expect(EXAMPLES.team).toMatch(/Giveth/);
  });

  it("example milestones are three rows that sum to the example goal with one adoption row", () => {
    expect(EXAMPLE_MILESTONES).toHaveLength(3);
    const total = EXAMPLE_MILESTONES.reduce((a, m) => a + m.amount, 0);
    expect(total).toBe(150000);
    expect(parseAmount(EXAMPLE_PAGE.goal)).toBe(total);
    expect(EXAMPLE_MILESTONES.filter((m) => m.adoption)).toHaveLength(1);
    expect(EXAMPLE_MILESTONES.every((m) => m.criteria.length > 0)).toBe(true);
    expect(EXAMPLE_PAGE.title).toContain("OPSEC");
  });
});
