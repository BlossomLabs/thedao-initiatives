import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderDraft, replaceFromText, textMatchesDraft, UNSORTED_HEADING } from "./draft-text";
import { emptyBacker, emptyDraft } from "./useDraft";

const EXAMPLE = readFileSync("docs/llms-v3-example-output.md", "utf8");

describe("renderDraft", () => {
  it("renders nothing for an empty draft, so the placeholder shows", () => {
    expect(renderDraft(emptyDraft())).toBe("");
  });

  it("writes the guide's paste format in the guide's order", () => {
    const d = emptyDraft();
    d.page.title = "A title";
    d.page.goal = "150000";
    d.page.duration = "18";
    d.sections.why = "Because.";
    d.milestones[0].name = "First";
    d.milestones[0].amount = "150,000";
    d.milestones[0].adoption = true;
    d.milestones[0].criteria[0].text = "Checkable";
    d.backers = [{ ...emptyBacker(), org: "EF", amount: "20000", url: "https://ethereum.org" }];
    expect(renderDraft(d)).toBe(
      [
        "## Title",
        "",
        "A title",
        "",
        "## Funding goal (USD)",
        "",
        "$150,000",
        "",
        "## Expected duration (months)",
        "",
        "18",
        "",
        "## Backers already committed",
        "",
        "EF | $20,000 | https://ethereum.org",
        "",
        "## Why this matters",
        "",
        "Because.",
        "",
        "## Milestones",
        "",
        "### First - $150,000 (adoption)",
        "- Checkable",
      ].join("\n"),
    );
  });

  it("puts unsorted text at the end under its own heading when it has none", () => {
    const d = emptyDraft();
    d.page.title = "T";
    d.unsorted = "stray line";
    const text = renderDraft(d);
    expect(text.endsWith(`${UNSORTED_HEADING}\n\nstray line`)).toBe(true);
    const back = replaceFromText(emptyDraft(), text);
    expect(back.page.title).toBe("T");
    expect(back.unsorted).toBe(`${UNSORTED_HEADING}\n\nstray line`);
    // and it does not grow a heading per round trip
    expect(renderDraft(back)).toBe(text);
  });
});

describe("replaceFromText", () => {
  it("empties a field whose heading is gone and keeps what the text cannot carry", () => {
    let d = emptyDraft();
    d.type = "grant";
    d.topup = true;
    d.milestoneReviewer = "Rev";
    d.page.recipientUrl = "https://team.example";
    d.page.discourseUrl = "https://forum.example/t/1";
    d.page.summary = "old summary";
    d.sections.why = "old why";
    d.sections.hard_req = "rfp-only text, kept for a switch back";
    d = replaceFromText(d, "## Title\n\nNew\n\n## Recipient team\n\nTeam\n");
    expect(d.page.title).toBe("New");
    expect(d.page.summary).toBe("");
    expect(d.page.recipientTeam).toBe("Team");
    expect(d.sections.why).toBeUndefined();
    expect(d.sections.hard_req).toBe("rfp-only text, kept for a switch back");
    expect(d.type).toBe("grant");
    expect(d.topup).toBe(true);
    expect(d.milestoneReviewer).toBe("Rev");
    expect(d.page.recipientUrl).toBe("https://team.example");
    expect(d.page.discourseUrl).toBe("https://forum.example/t/1");
    expect(d.milestones).toHaveLength(1);
    expect(d.milestones[0].name).toBe("");
  });

  it("leaves locked fields as the draft has them, whatever the text says (#71)", () => {
    const d = emptyDraft();
    d.type = "grant";
    d.page = { ...d.page, goal: "34,500", duration: "6", recipientTeam: "Team" };
    d.priv = { funders: "F", contact: "c@example.org" };
    d.backers = [{ ...emptyBacker(), org: "Argot", amount: "1,000" }];
    const text = "## Title\n\nNew\n\n## Funding goal (USD)\n\n$11,500\n\n" +
      "## Expected duration (months)\n\n2\n\n## Recipient team\n\nOthers\n";
    const all = replaceFromText(d, text, { facts: true, goal: true, backers: true });
    expect(all.page).toMatchObject({
      title: "New",
      goal: "34,500",
      duration: "6",
      recipientTeam: "Team",
    });
    expect(all.priv).toEqual(d.priv);
    expect(all.backers).toEqual(d.backers);
    // the goal alone can be open: a proposer's edit to an approved initiative
    const open = replaceFromText(d, text, { facts: true, backers: true });
    expect(open.page).toMatchObject({ goal: "11,500", duration: "6", recipientTeam: "Team" });
  });

  it("keeps a backer's id and logo when its organization is still in the text", () => {
    const d = emptyDraft();
    d.backers = [
      {
        ...emptyBacker(),
        org: "EF",
        amount: "20,000",
        url: "https://ethereum.org",
        logoCid: "cid",
      },
      { ...emptyBacker(), org: "Gone", amount: "5,000", url: "" },
    ];
    const out = replaceFromText(
      d,
      "## Backers already committed\n\nef | $25,000 | https://ethereum.org\nNew | $1,000 | https://n\n",
    );
    expect(out.backers).toHaveLength(2);
    expect(out.backers[0].id).toBe(d.backers[0].id);
    expect(out.backers[0].logoCid).toBe("cid");
    expect(out.backers[0].amount).toBe("25,000");
    expect(out.backers[1].org).toBe("New");
    expect(out.backers[1].id).not.toBe(d.backers[1].id);
  });

  it("keeps milestone and criterion ids by position", () => {
    const d = emptyDraft();
    d.milestones[0].name = "First";
    d.milestones[0].criteria[0].text = "one";
    const out = replaceFromText(
      d,
      "## Milestones\n\n### Renamed - $10\n- one\n- two\n\n### Second - $20\n- x\n",
    );
    expect(out.milestones[0].id).toBe(d.milestones[0].id);
    expect(out.milestones[0].criteria[0].id).toBe(d.milestones[0].criteria[0].id);
    expect(out.milestones[0].criteria[1].text).toBe("two");
    expect(out.milestones[1].name).toBe("Second");
  });

  it("round-trips the guide's example: render, replace, render is stable", () => {
    const first = replaceFromText(emptyDraft(), EXAMPLE);
    const text = renderDraft(first);
    const second = replaceFromText(first, text);
    expect(renderDraft(second)).toBe(text);
    expect(second.page.title).toBe(first.page.title);
    expect(second.sections).toEqual(first.sections);
    expect(second.milestones.map((m) => [m.name, m.amount, m.criteria.length])).toEqual(
      first.milestones.map((m) => [m.name, m.amount, m.criteria.length]),
    );
    expect(textMatchesDraft(first, text)).toBe(true);
    expect(textMatchesDraft(first, EXAMPLE)).toBe(true);
    expect(textMatchesDraft(first, "## Title\n\nOther")).toBe(false);
  });
});

describe("categories in the text", () => {
  it("renders a Categories section right after the summary, primary first", () => {
    const d = emptyDraft();
    d.page.title = "T";
    d.page.summary = "S";
    d.page.goal = "1,000";
    d.categories = ["defi", "opsec"];
    expect(renderDraft(d)).toContain(
      "## Short summary\n\nS\n\n## Categories\n\nDeFi Safety\nOpSec\n\n## Funding goal",
    );
  });

  it("round-trips through the text in order", () => {
    const d = emptyDraft();
    d.page.title = "T";
    d.categories = ["research-education", "compilers"];
    expect(replaceFromText(emptyDraft(), renderDraft(d)).categories)
      .toEqual(["research-education", "compilers"]);
    expect(textMatchesDraft(d, renderDraft(d))).toBe(true);
  });

  it("no categories, no heading", () => {
    const d = emptyDraft();
    d.page.title = "T";
    expect(renderDraft(d)).not.toContain("Categories");
  });
});
