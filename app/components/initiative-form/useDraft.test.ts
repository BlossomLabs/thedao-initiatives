import { describe, expect, it } from "vitest";
import { splitDraft } from "@shared/draft/mod";
import {
  draftReducer,
  type DraftState,
  emptyBacker,
  emptyCriterion,
  emptyDraft,
  emptyMilestone,
  fromInitiative,
  isEmptyDraft,
  splitReport,
  toCheckInput,
  toPayload,
} from "./useDraft";
import type { Initiative } from "~/lib/api-types";
import { structuredRow } from "../../../test/fixtures";

const state = (): DraftState => ({ draft: emptyDraft() });

describe("useDraft reducer", () => {
  it("keeps categories in the draft, ordered, unique, known and at most three", () => {
    const s = draftReducer(state(), {
      t: "setCategories",
      value: ["opsec", "defi", "opsec", "nope", "audits-analysis", "compilers"],
    });
    expect(s.draft.categories).toEqual(["opsec", "defi", "audits-analysis"]);
    expect(toPayload(s.draft).categories).toEqual(["opsec", "defi", "audits-analysis"]);
  });

  it("a paste sets the categories from its Categories section, like any other field", () => {
    let s = draftReducer(state(), { t: "setCategories", value: ["defi"] });
    s = draftReducer(s, {
      t: "replaceText",
      text: "## Title\nNew title\n\n## Categories\nOpSec\nResearch & Education\n",
    });
    expect(s.draft.page.title).toBe("New title");
    expect(s.draft.categories).toEqual(["opsec", "research-education"]);
    // a text without the section empties the field, as with every other heading
    s = draftReducer(s, { t: "replaceText", text: "## Title\nNew title\n" });
    expect(s.draft.categories).toEqual([]);
  });

  it("the paste report counts categories and names the unknown ones", () => {
    const r = splitReport(splitDraft("## Categories\nOpSec\nZK stuff\n", "rfp"), "rfp");
    expect(r.categories).toBe(1);
    expect(r.unknownCategories).toEqual(["ZK stuff"]);
    expect(splitReport(splitDraft("## Title\nT\n", "rfp"), "rfp").categories).toBe(0);
  });

  it("a draft with only categories is not empty", () => {
    const d = emptyDraft();
    expect(d.categories).toEqual([]);
    expect(isEmptyDraft({ ...d, categories: ["defi"] })).toBe(false);
  });

  it("an initiative's categories seed the edit draft", () => {
    const d = fromInitiative({ ...structuredRow(), categories: ["opsec", "defi"] });
    expect(d.categories).toEqual(["opsec", "defi"]);
  });

  it("setType to rfp clears the top-up; a grant keeps it", () => {
    let s = draftReducer(state(), { t: "setType", type: "grant" });
    s = draftReducer(s, { t: "setTopup", topup: true });
    expect(s.draft.topup).toBe(true);
    s = draftReducer(s, { t: "setType", type: "rfp" });
    expect(s.draft.topup).toBe(false);
    // a top-up on an RFP is ignored
    s = draftReducer(s, { t: "setTopup", topup: true });
    expect(s.draft.topup).toBe(false);
  });

  it("re-letters milestones from their index after a removal", () => {
    let s = state();
    const a = s.draft.milestones[0].id;
    const b = emptyMilestone();
    const c = emptyMilestone();
    s = draftReducer(s, { t: "addMilestone", row: b });
    s = draftReducer(s, { t: "addMilestone", row: c });
    s = draftReducer(s, { t: "setMilestone", id: c.id, patch: { name: "Third" } });
    s = draftReducer(s, { t: "removeMilestone", id: a });
    expect(s.draft.milestones.map((m) => m.id)).toEqual([b.id, c.id]);
    // the payload letters by position: "Third" is now B (index 1)
    expect(toPayload(s.draft).milestones[1].name).toBe("Third");
  });

  it("insertCriterion adds after the given row and flattens newlines on set", () => {
    let s = state();
    const ms = s.draft.milestones[0];
    const first = ms.criteria[0];
    const inserted = emptyCriterion();
    s = draftReducer(s, { t: "insertCriterion", ms: ms.id, after: first.id, row: inserted });
    const tail = emptyCriterion();
    s = draftReducer(s, { t: "insertCriterion", ms: ms.id, after: null, row: tail });
    expect(s.draft.milestones[0].criteria.map((c) => c.id)).toEqual([
      first.id,
      inserted.id,
      tail.id,
    ]);
    s = draftReducer(s, {
      t: "setCriterion",
      ms: ms.id,
      id: inserted.id,
      value: "one\r\nline\nonly",
    });
    expect(s.draft.milestones[0].criteria[1].text).toBe("one line only");
    s = draftReducer(s, { t: "removeCriterion", ms: ms.id, id: first.id });
    expect(s.draft.milestones[0].criteria.map((c) => c.id)).toEqual([inserted.id, tail.id]);
  });

  it("splitReport counts the type's sections and flags the other type's", () => {
    const res = splitDraft("## Why this matters\nx\n## The team\ny\n## Commitments\nz", "rfp");
    const r = splitReport(res, "rfp");
    expect(r.sections).toBe(1);
    expect(r.otherType).toEqual(["team", "commitments"]);
    expect(splitReport(res, "grant").sections).toBe(3);
  });

  it("toPayload parses amounts, drops empty criteria and other-type sections", () => {
    const d = emptyDraft();
    d.page.goal = "150.000";
    d.page.duration = "12";
    d.page.links = "https://a.example\n\n  https://b.example  ";
    d.sections = { why: "why", team: "grant only" };
    d.milestones[0].name = "A";
    d.milestones[0].amount = "$100,000.50";
    d.milestones[0].criteria = [emptyCriterion("ok"), emptyCriterion("  ")];
    d.milestones[0].done = true;
    d.milestones[0].link = "https://x.example";
    d.backers = [
      { ...emptyBacker(), org: "EF", amount: "20,000", logoCid: "bafy" },
      emptyBacker(),
    ];
    const p = toPayload(d);
    expect(p.goal).toBe("150000");
    expect(p.durationMonths).toBe("12");
    expect(p.links).toEqual(["https://a.example", "https://b.example"]);
    expect(p.sections).toEqual({ why: "why" });
    expect(p.milestones[0]).toMatchObject({ amount: 100000.5, criteria: ["ok"] });
    // done and its link only mean something on a top-up
    expect(p.milestones[0].done).toBe(false);
    expect(p.milestones[0].link).toBe("");
    expect(p.backers).toEqual([{ org: "EF", amountUsd: 20000, url: "", logoCid: "bafy" }]);
    expect(toPayload(d, { [d.backers[0].id]: "newcid" }).backers[0].logoCid).toBe("newcid");
    expect(p.website).toBe("");
  });

  it("fromInitiative round-trips through toPayload", () => {
    const r: Initiative = {
      id: "1",
      slug: "x",
      title: "Title here",
      summary: "Summary",
      details: "",
      discourseUrl: "",
      goalUsd: 150000,
      status: "pending",
      type: "grant",
      sortRank: null,
      safeAddress: "",
      paidOutUsd: 0,
      proposer: "",
      durationMonths: 9,
      recipientTeam: "Team",
      recipientUrl: "https://team.example",
      topup: true,
      milestoneReviewer: "N.",
      categories: [],
      sections: { why: "w", team: "t" },
      milestones: [{
        name: "A",
        amount: 150000,
        adoption: true,
        done: true,
        link: "https://d.example",
        month: "",
        criteria: ["c1"],
      }],
      links: ["https://l.example"],
      structured: true,
      revision: 1,
      createdAt: 0,
      approvedAt: null,
    };
    const d = fromInitiative(r);
    expect(isEmptyDraft(d)).toBe(false);
    expect(d.page.goal).toBe("150,000");
    const p = toPayload(d);
    expect(p).toMatchObject({
      type: "grant",
      topup: true,
      goal: "150000",
      durationMonths: "9",
      recipientTeam: "Team",
      milestoneReviewer: "N.",
      sections: { why: "w", team: "t" },
      links: ["https://l.example"],
    });
    expect(p.milestones[0]).toEqual(r.milestones[0]);
  });

  it("fromInitiative seeds read-only backers from the live pledges", () => {
    const r = { ...structuredRow(), topup: true, goalUsd: 281_000 };
    const d = fromInitiative(r, [
      { company: "Argot", amountUsd: 150_000, url: "https://argot.org", status: "pledged" },
      { company: "Gone", amountUsd: 1_000_000, url: "", status: "withdrawn" },
    ]);
    expect(d.backers).toHaveLength(1);
    expect(d.backers[0]).toMatchObject({
      org: "Argot",
      amount: "150,000",
      url: "https://argot.org",
      logo: null,
      logoCid: "",
    });
    expect(toCheckInput(d).backers).toEqual([
      { org: "Argot", amountUsd: 150_000, url: "https://argot.org" },
    ]);
  });

  it("isEmptyDraft is true for a fresh draft only", () => {
    expect(isEmptyDraft(emptyDraft())).toBe(true);
    const d = emptyDraft();
    d.milestones[0].criteria[0].text = "x";
    expect(isEmptyDraft(d)).toBe(false);
  });
});
