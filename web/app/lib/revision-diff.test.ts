import { describe, expect, it } from "vitest";
import { changed, diffRevisions, diffText } from "./revision-diff";
import type { Milestone, RevisionText } from "./api-types";

const join = (chunks: ReturnType<typeof diffText>, keep: "before" | "after") =>
  chunks.filter((c) => keep === "before" ? !c.added : !c.removed).map((c) => c.value).join("");

const legacy: RevisionText = {
  title: "T",
  summary: "S",
  details: "",
  sections: {},
  milestones: [],
  links: [],
};
const ms = (over: Partial<Milestone> = {}): Milestone => ({
  name: "Spec",
  amount: 50_000,
  adoption: false,
  done: false,
  link: "",
  month: "",
  criteria: ["Published"],
  ...over,
});

describe("revision diff", () => {
  it("marks inserted and removed words and reconstructs both sides", () => {
    const d = diffText("a quick fox", "a slow\nfox");
    expect(join(d, "before")).toBe("a quick fox");
    expect(join(d, "after")).toBe("a slow\nfox");
    expect(d.filter((c) => c.removed).map((c) => c.value).join("")).toContain("quick");
    expect(d.filter((c) => c.added).map((c) => c.value).join("")).toContain("slow");
    expect(changed(d)).toBe(true);
    expect(changed(diffText("same", "same"))).toBe(false);
  });

  it("treats a missing previous revision as all new", () => {
    const d = diffRevisions(null, legacy);
    expect(d.title).toEqual([{ value: "T", added: true, removed: false }]);
    expect(d.details).toEqual([]);
    expect(d.sections).toEqual([]);
    expect(d.milestones).toEqual([]);
    expect(d.links).toEqual([]);
    expect(d.structured).toBe(false);
  });

  it("tolerates legacy callers that omit the structured fields", () => {
    const old = { title: "T", summary: "S", details: "body" } as unknown as RevisionText;
    const d = diffRevisions(old, { ...old, details: "body two" });
    expect(join(d.details, "after")).toBe("body two");
    expect(d.structured).toBe(false);
    expect(d.sections).toEqual([]);
  });

  it("diffs sections in type order, then keys only one side had", () => {
    const before: RevisionText = {
      ...legacy,
      sections: { why: "old why", in_scope: "scope", team: "the team" },
    };
    const after: RevisionText = {
      ...legacy,
      sections: { why: "new why", in_scope: "scope", hard_req: "must" },
    };
    const d = diffRevisions(before, after, "rfp");
    expect(d.structured).toBe(true);
    expect(d.sections.map((s) => s.key)).toEqual(["why", "in_scope", "hard_req", "team"]);
    expect(d.sections[0].heading).toBe("Why this matters");
    expect(changed(d.sections[0].chunks)).toBe(true);
    expect(changed(d.sections[1].chunks)).toBe(false);
    expect(d.sections[2].chunks).toEqual([{ value: "must", added: true, removed: false }]);
    expect(d.sections[3].chunks).toEqual([{ value: "the team", added: false, removed: true }]);
    // grant order puts the grant-only key inside the type block
    const g = diffRevisions(before, after, "grant");
    expect(g.sections.map((s) => s.key)).toEqual(["why", "team", "in_scope", "hard_req"]);
  });

  it("diffs milestones in the edit format and links one per line", () => {
    const before: RevisionText = {
      ...legacy,
      milestones: [ms()],
      links: ["https://a.example", "https://b.example"],
    };
    const after: RevisionText = {
      ...legacy,
      milestones: [ms({ amount: 60_000, adoption: true })],
      links: ["https://a.example", "https://c.example"],
    };
    const d = diffRevisions(before, after, "grant");
    expect(d.structured).toBe(true);
    expect(join(d.milestones, "before")).toBe("### Spec - $50,000\n- Published");
    expect(join(d.milestones, "after")).toBe("### Spec - $60,000 (adoption)\n- Published");
    expect(join(d.links, "after")).toBe("https://a.example\nhttps://c.example");
    expect(join(d.links, "before")).toBe("https://a.example\nhttps://b.example");
    expect(changed(d.links)).toBe(true);
  });

  it("is structured when only one side is", () => {
    const d = diffRevisions({ ...legacy, details: "old blob" }, { ...legacy, milestones: [ms()] });
    expect(d.structured).toBe(true);
    expect(join(d.details, "before")).toBe("old blob");
  });
});
