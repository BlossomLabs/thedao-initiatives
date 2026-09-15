import { render, screen } from "@testing-library/react";
import Sections from "./Sections";
import type { Sections as SectionsMap } from "~/lib/api-types";
import { diffRevisions } from "~/lib/revision-diff";

const sections: SectionsMap = {
  why: "Because **reasons**.",
  in_scope: "Build it.",
  out_scope: "",
  existing: "None.",
  who: "A team.",
  hard_req: "1. Tests.",
  team: "Us.",
  why_grant: "We started.",
  commitments: "MIT.",
};

const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("Sections", () => {
  it("renders the RFP sections in order, skipping empty and grant-only keys", () => {
    render(<Sections type="rfp" sections={sections} />);
    expect(headings()).toEqual([
      "Why this matters",
      "In scope",
      "Existing work",
      "Who we expect to do this",
      "Hard requirements",
    ]);
    expect(screen.getByRole("heading", { name: "Why this matters" })).toHaveAttribute("id", "why");
    expect(screen.getByText("reasons").tagName).toBe("STRONG");
  });

  it("renders the grant order", () => {
    render(<Sections type="grant" sections={sections} />);
    expect(headings()).toEqual([
      "Why this matters",
      "The team",
      "Why a grant: what already exists",
      "In scope",
      "Commitments",
    ]);
  });

  it("in changes mode shows a diff per key on either side, other-type keys last", () => {
    const base = { title: "", summary: "", details: "", milestones: [], links: [] };
    const diff = diffRevisions(
      { ...base, sections: { why: "old", team: "was grant" } },
      { ...base, sections: { why: "new", hard_req: "must" } },
      "rfp",
    );
    const { container } = render(<Sections type="rfp" sections={{}} diff={diff} />);
    expect(headings()).toEqual(["Why this matters", "Hard requirements", "The team"]);
    expect(container.querySelectorAll(".diff")).toHaveLength(3);
    expect(container.querySelector(".diff del")?.textContent).toBe("old");
    expect(container.querySelector("#team .diff, #team ~ .diff del")).toBeTruthy();
  });
});
