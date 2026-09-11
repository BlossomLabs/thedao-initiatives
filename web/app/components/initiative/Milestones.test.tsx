import { render, screen } from "@testing-library/react";
import Milestones from "./Milestones";
import type { Milestone } from "~/lib/api-types";
import { diffRevisions } from "~/lib/revision-diff";

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
const rows: Milestone[] = [
  ms({ name: "Agreed standard", amount: 50_000, criteria: ["Spec published", "Two reviews"] }),
  ms({ name: "Reference implementation", amount: 25_000, month: "2026-11" }),
  ms({
    name: "Adopted by three teams",
    amount: 75_000,
    adoption: true,
    criteria: ["Three deploys"],
  }),
];

describe("Milestones", () => {
  it("letters the rows, shows amounts, the adoption chip and the footer", () => {
    const { container } = render(<Milestones type="grant" topup={false} milestones={rows} />);
    expect(screen.getByRole("heading", { name: /^Milestones\s*\(3\)$/ })).toBeInTheDocument();
    const items = container.querySelectorAll("ol > li");
    expect(items).toHaveLength(3);
    expect(items[0].id).toBe("milestone-A");
    expect(items[2].id).toBe("milestone-C");
    expect(items[0].textContent).toMatch(/^A/);
    expect(items[1].textContent).toMatch(/^B/);
    expect(screen.getByRole("heading", { name: "Agreed standard" })).toBeInTheDocument();
    expect(screen.getByText("$50,000")).toBeInTheDocument();
    expect(screen.getByText("$75,000")).toBeInTheDocument();
    expect(screen.getAllByText("adoption milestone")).toHaveLength(1);
    expect(screen.getByText("3 milestones, $150,000 total; $75,000 (50%) tied to adoption"))
      .toBeInTheDocument();
    // criteria are an unchecked task list; no top-up chips on a plain grant
    const boxes = container.querySelectorAll("li.task input[type=checkbox]");
    expect(boxes).toHaveLength(4);
    boxes.forEach((b) => expect(b).not.toBeChecked());
    expect(screen.queryByText(/target /)).not.toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
  });

  it("calls them a draft on an RFP and omits the adoption clause when none", () => {
    render(
      <Milestones
        type="rfp"
        topup={false}
        milestones={rows.map((m) => ({ ...m, adoption: false }))}
      />,
    );
    expect(screen.getByRole("heading", { name: /^Milestones \(draft\)\s*\(3\)$/ }))
      .toBeInTheDocument();
    expect(screen.getByText("3 milestones, $150,000 total")).toBeInTheDocument();
    expect(screen.queryByText(/tied to adoption/)).not.toBeInTheDocument();
  });

  it("on a top-up: done rows are checked with a Delivered link, the rest show a target month", () => {
    const topup = [
      ms({
        name: "Done one",
        done: true,
        link: "https://example.org/report",
        criteria: ["Shipped"],
      }),
      ms({ name: "Bad link", done: true, link: "javascript:alert(1)", criteria: ["Shipped"] }),
      ms({ name: "Next", month: "2026-11", criteria: ["Pending"] }),
    ];
    const { container } = render(<Milestones type="grant" topup milestones={topup} />);
    expect(screen.getAllByText("done")).toHaveLength(2);
    const items = container.querySelectorAll("ol > li");
    expect(items[0].querySelector("input[type=checkbox]")).toBeChecked();
    expect(items[1].querySelector("input[type=checkbox]")).toBeChecked();
    expect(items[2].querySelector("input[type=checkbox]")).not.toBeChecked();
    const delivered = screen.getByRole("link", {
      name: /Delivered: https:\/\/example.org\/report/,
    });
    expect(delivered).toHaveAttribute("href", "https://example.org/report");
    expect(delivered).toHaveAttribute("target", "_blank");
    expect(screen.queryByText(/javascript:/)).not.toBeInTheDocument();
    expect(screen.getByText(/target Nov 2026/)).toBeInTheDocument();
    // done rows get the check badge instead of the letter
    expect(items[0].textContent).not.toMatch(/^A/);
    expect(items[2].textContent).toMatch(/^C/);
  });

  it("ignores done and month on a plain grant", () => {
    const { container } = render(
      <Milestones
        type="grant"
        topup={false}
        milestones={[ms({ done: true, link: "https://example.org/x", month: "2026-11" })]}
      />,
    );
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.queryByText(/target /)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("input[type=checkbox]")).not.toBeChecked();
  });

  it("renders nothing without rows, and a diff block in changes mode", () => {
    const { container, rerender } = render(
      <Milestones type="grant" topup={false} milestones={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
    const base = { title: "", summary: "", details: "", sections: {}, links: [] };
    const diff = diffRevisions({ ...base, milestones: [rows[0]] }, { ...base, milestones: rows });
    rerender(<Milestones type="rfp" topup={false} milestones={rows} diff={diff} />);
    expect(screen.getByRole("heading", { name: "Milestones (draft)" })).toBeInTheDocument();
    expect(container.querySelector(".diff")).toBeInTheDocument();
    expect(container.querySelector(".diff ins")?.textContent).toContain("Reference implementation");
    expect(container.querySelectorAll("ol > li")).toHaveLength(0);
  });
});
