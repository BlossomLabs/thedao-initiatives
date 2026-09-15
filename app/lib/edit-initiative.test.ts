import { describe, expect, it } from "vitest";
import { fromInitiative, toPayload } from "~/components/initiative-form/useDraft";
import { structuredRow } from "../../test/fixtures";
import { pageFactsPatch, rowFacts, textBody, textChanged } from "./edit-initiative";

describe("edit-initiative helpers", () => {
  it("a draft from the row round-trips to no patch and no text change", () => {
    const r = structuredRow();
    const payload = toPayload(fromInitiative(r));
    expect(pageFactsPatch(payload, r)).toBeNull();
    expect(textChanged(payload, r)).toBe(false);
    expect(rowFacts(r)).toMatchObject({
      type: "grant",
      topup: false,
      goal: "150000",
      durationMonths: "12",
      recipientTeam: "Rollup Labs",
      milestoneReviewer: "",
      funders: "Ethereum Foundation | yes",
      contact: "me@example.org",
    });
  });

  it("only the page facts that differ go into the PATCH", () => {
    const r = structuredRow();
    const d = fromInitiative(r);
    d.page.goal = "200,000";
    d.priv.contact = "other@example.org";
    const patch = pageFactsPatch(toPayload(d), r);
    expect(patch).toEqual({ goal: "200000", contact: "other@example.org" });
    // a text-only change is not a page-fact change
    expect(textChanged(toPayload(d), r)).toBe(false);
  });

  it("a type switch clears the grant-only facts in the patch", () => {
    const r = structuredRow();
    const d = fromInitiative(r);
    d.type = "rfp";
    expect(pageFactsPatch(toPayload(d), r)).toEqual({
      type: "rfp",
      recipientTeam: "",
      recipientUrl: "",
    });
  });

  it("the revision body carries only the text; a changed milestone counts as changed", () => {
    const r = structuredRow();
    const d = fromInitiative(r);
    d.milestones[0].criteria[0].text = "A different criterion";
    const payload = toPayload(d);
    expect(textChanged(payload, r)).toBe(true);
    expect(Object.keys(textBody(payload)).sort()).toEqual([
      "links",
      "milestones",
      "sections",
      "summary",
      "title",
    ]);
    expect(textBody(payload).milestones[0].criteria).toEqual(["A different criterion"]);
  });

  it("a legacy row always counts as a text change (posting sections migrates it)", () => {
    const r = { ...structuredRow(), structured: false, sections: {}, milestones: [], links: [] };
    r.details = "## Why this matters\nold body";
    const payload = toPayload(fromInitiative(r));
    expect(textChanged(payload, r)).toBe(true);
  });
});
