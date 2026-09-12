import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import PasteBox, { MIRROR_DELAY } from "./PasteBox";
import { useDraft } from "./useDraft";

const EXAMPLE = readFileSync("../docs/llms-v3-example-output.md", "utf8");

/** PasteBox on a real draft, with the bits of the draft the tests read and
 * one section field to edit from the other side. */
function Harness() {
  const { draft, actions } = useDraft();
  return (
    <>
      <PasteBox
        draft={draft}
        onText={actions.replaceText}
        onUnsorted={actions.setUnsorted}
      />
      <span data-testid="title">{draft.page.title}</span>
      <span data-testid="goal">{draft.page.goal}</span>
      <span data-testid="why">{draft.sections.why ?? ""}</span>
      <span data-testid="ms">{draft.milestones.map((m) => m.name).join("|")}</span>
      <input
        aria-label="Title field"
        value={draft.page.title}
        onChange={(e) => actions.setPage("title", e.target.value)}
      />
      <textarea
        aria-label="Why field"
        value={draft.sections.why ?? ""}
        onChange={(e) => actions.setSection("why", e.target.value)}
      />
    </>
  );
}

const box = () => screen.getByLabelText(/Your whole draft as one text/) as HTMLTextAreaElement;

const paste = (text: string) => {
  const ta = box();
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.paste(ta);
  return ta;
};

const settle = () => new Promise((r) => setTimeout(r, MIRROR_DELAY + 50));

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
    // the pasted text stays as pasted: the box is not rewritten by its own edit
    expect(box().value).toBe(EXAMPLE);
  });

  it("shows the unsorted box for lines that matched nothing", async () => {
    render(<Harness />);
    paste("## Why this matters\n\nBecause.\n\n## Random heading\n\nstray line\n");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "Sorted: 1 section, 0 milestones, 0 page fields, plus text nothing matched.",
    );
    expect(screen.getByText("Unsorted text")).toBeInTheDocument();
    const unsorted = document.getElementById("f-unsorted") as HTMLTextAreaElement;
    expect(unsorted.value).toContain("## Random heading");
    expect(unsorted.value).toContain("stray line");
    fireEvent.click(screen.getByRole("button", { name: "Clear the box" }));
    expect(screen.queryByText("Unsorted text")).not.toBeInTheDocument();
    // clearing the amber box drops those lines from the draft text too
    expect(box().value).toBe("## Why this matters\n\nBecause.");
  });

  it("typed text fills the fields after a pause, without rewriting the box", async () => {
    render(<Harness />);
    const ta = box();
    fireEvent.focus(ta);
    fireEvent.change(ta, { target: { value: "## Title\n\nTyped\n\n## Why this matters\n\nx" } });
    expect(screen.getByTestId("title")).toHaveTextContent("");
    await act(settle);
    expect(screen.getByTestId("title")).toHaveTextContent("Typed");
    expect(screen.getByTestId("why")).toHaveTextContent("x");
    expect(ta.value).toBe("## Title\n\nTyped\n\n## Why this matters\n\nx");
    // deleting a heading empties its field
    fireEvent.change(ta, { target: { value: "## Why this matters\n\nx" } });
    await act(settle);
    expect(screen.getByTestId("title")).toHaveTextContent("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("editing a field rewrites the box in the paste format", async () => {
    render(<Harness />);
    paste("## Title\n\nOld\n");
    await screen.findByRole("status");
    fireEvent.change(screen.getByLabelText("Title field"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Why field"), { target: { value: "Because." } });
    await waitFor(() =>
      expect(box().value).toBe("## Title\n\nNew\n\n## Why this matters\n\nBecause.")
    );
  });

  it("hints when grant headings land on an RFP", async () => {
    render(<Harness />);
    paste("## The team\n\nUs.\n\n## Commitments\n\nMIT.\n");
    expect(await screen.findByRole("status")).toHaveTextContent("Sorted: 0 sections");
    expect(screen.getByText(/Switch to Grant to sort The team and Commitments/))
      .toBeInTheDocument();
  });
});

describe("PasteBox placeholder", () => {
  it("shows a skeleton draft while empty and shrinks once text is in", () => {
    render(<Harness />);
    const ta = box();
    expect(ta.placeholder).toContain("### Agreed standard - $50,000");
    expect(ta.placeholder).toContain("Organization | $20,000 | https://link");
    expect(ta.rows).toBe(17);
    fireEvent.change(ta, { target: { value: "## Why this matters\n\nx" } });
    expect(ta.rows).toBe(12);
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
