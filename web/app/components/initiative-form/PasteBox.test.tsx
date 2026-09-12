import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import PasteBox from "./PasteBox";
import { useDraft } from "./useDraft";

const EXAMPLE = readFileSync("../docs/llms-v3-example-output.md", "utf8");

/** PasteBox on a real draft, with the bits of the draft the tests read. */
function Harness({ type = "rfp" as const }) {
  const { draft, actions, canUndo } = useDraft();
  return (
    <>
      <PasteBox
        type={type}
        onSplit={actions.applySplit}
        onUndo={actions.undoSplit}
        canUndo={canUndo}
        unsorted={draft.unsorted}
        onUnsorted={actions.setUnsorted}
      />
      <span data-testid="title">{draft.page.title}</span>
      <span data-testid="goal">{draft.page.goal}</span>
      <span data-testid="why">{draft.sections.why ?? ""}</span>
      <span data-testid="ms">{draft.milestones.map((m) => m.name).join("|")}</span>
    </>
  );
}

const paste = (text: string) => {
  const ta = screen.getByLabelText(/Paste your whole draft here/) as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.paste(ta);
  return ta;
};

describe("PasteBox", () => {
  it("sorts the guide's example on paste and reports what it filled", async () => {
    render(<Harness />);
    paste(EXAMPLE);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Sorted: 6 sections, 3 milestones, 5 page fields.");
    expect(screen.getByTestId("title")).toHaveTextContent(
      'OPSEC Ratings Coalition to Build & Maintain an "L2Beat for OPSEC"',
    );
    expect(screen.getByTestId("goal")).toHaveTextContent("150,000");
    expect(screen.getByTestId("why")).toHaveTextContent(/Your keys, your devices/);
    expect(screen.getByTestId("ms")).toHaveTextContent(
      "Agreed standard|Board and first ratings|Adoption evidence",
    );
    expect(screen.queryByText("Unsorted text")).not.toBeInTheDocument();
    // Undo puts the draft back
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("title")).toHaveTextContent("");
    expect(screen.getByTestId("ms")).toHaveTextContent("");
  });

  it("shows the unsorted box for lines that matched nothing", async () => {
    render(<Harness />);
    paste("## Why this matters\n\nBecause.\n\n## Random heading\n\nstray line\n");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "Sorted: 1 section, 0 milestones, 0 page fields, plus text nothing matched.",
    );
    expect(screen.getByText("Unsorted text")).toBeInTheDocument();
    const box = document.getElementById("f-unsorted") as HTMLTextAreaElement;
    expect(box.value).toContain("## Random heading");
    expect(box.value).toContain("stray line");
    fireEvent.click(screen.getByRole("button", { name: "Clear the box" }));
    expect(screen.queryByText("Unsorted text")).not.toBeInTheDocument();
  });

  it("the Sort button sorts typed text, and hints when grant headings land on an RFP", () => {
    render(<Harness />);
    const ta = screen.getByLabelText(/Paste your whole draft here/);
    fireEvent.change(ta, { target: { value: "## The team\n\nUs.\n\n## Commitments\n\nMIT.\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Sort this text" }));
    expect(screen.getByRole("status")).toHaveTextContent("Sorted: 0 sections");
    expect(screen.getByText(/Switch to Grant to sort The team and Commitments/))
      .toBeInTheDocument();
  });
});

describe("PasteBox hints", () => {
  it("says nothing when the example sorts cleanly", async () => {
    render(<Harness />);
    paste(EXAMPLE);
    await screen.findByRole("status");
    expect(document.querySelector('[data-field="paste-hints"]')).toBeNull();
  });

  it("names exactly what did not read: amounts, criteria, backers, missing milestones", async () => {
    render(<Harness />);
    paste(
      "## Why this matters\n\nBecause.\n\n## Backers already committed\n\nArgot 20000\n\n" +
        "## Milestones\n\n### First\n- done\n\n### Second - $10,000\n\n### Third - $5,000\n- x\n",
    );
    await screen.findByRole("status");
    const hints = document.querySelector('[data-field="paste-hints"]')!.textContent!;
    expect(hints).toContain("Milestone A has no amount");
    expect(hints).toContain("Milestone B has no acceptance criteria");
    expect(hints).toContain("Backers go one per line");
    expect(hints).not.toContain("No milestones found");
    expect(hints).not.toContain("Unsorted box");
  });

  it("points at the milestones heading when none were found", async () => {
    render(<Harness />);
    paste("## Why this matters\n\nBecause.\n\n## Random\n\nlost\n");
    await screen.findByRole("status");
    const hints = document.querySelector('[data-field="paste-hints"]')!.textContent!;
    expect(hints).toContain("No milestones found");
    expect(hints).toContain("Unsorted box");
  });
});
