import { render, screen } from "@testing-library/react";
import KeyFacts from "./KeyFacts";
import RulesPanel from "./RulesPanel";
import type { Initiative, Summary } from "~/lib/api-types";

const base: Initiative = {
  id: "1",
  slug: "x",
  title: "X",
  summary: "",
  details: "",
  discourseUrl: "",
  goalUsd: 600_000,
  status: "approved",
  type: "grant",
  sortRank: null,
  safeAddress: "",
  paidOutUsd: 0,
  proposer: "",
  durationMonths: 12,
  recipientTeam: "Vyper core team",
  recipientUrl: "https://vyperlang.org/",
  topup: false,
  milestoneReviewer: "",
  sections: {},
  milestones: [],
  links: [],
  structured: false,
  revision: 1,
  createdAt: 0,
  approvedAt: 0,
};
const summary: Summary = {
  pledged: 150_000,
  donated: 0,
  total: 150_000,
  live: false,
  ledger: 0,
  paidOut: 0,
};

describe("KeyFacts", () => {
  it("shows duration and a linked recipient on a grant", () => {
    render(<KeyFacts r={base} summary={summary} />);
    expect(screen.getByText("About 12 months")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Vyper core team" });
    expect(link).toHaveAttribute("href", "https://vyperlang.org/");
    expect(screen.queryByText(/Already committed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Milestone reviewer/)).not.toBeInTheDocument();
  });

  it("adds the remaining amount and the reviewer on a top-up", () => {
    render(
      <KeyFacts
        r={{ ...base, topup: true, milestoneReviewer: "N. D'Andrea", durationMonths: null }}
        summary={summary}
      />,
    );
    expect(screen.getByText("Duration not stated")).toBeInTheDocument();
    expect(screen.getByText("Work already under way with another funder")).toBeInTheDocument();
    expect(screen.getByText("Already committed")).toBeInTheDocument();
    expect(screen.getByText("$150,000")).toBeInTheDocument();
    expect(screen.getByText("$450,000")).toBeInTheDocument();
    expect(screen.getByText("N. D'Andrea")).toBeInTheDocument();
  });

  it("hides grant-only rows on an RFP even if stale values are present", () => {
    render(<KeyFacts r={{ ...base, type: "rfp", durationMonths: 1 }} summary={summary} />);
    expect(screen.getByText("About 1 month")).toBeInTheDocument();
    expect(screen.queryByText("Vyper core team")).not.toBeInTheDocument();
  });
});

describe("RulesPanel", () => {
  it("picks the panel for the kind and stamps the version", () => {
    const { rerender } = render(<RulesPanel r={{ type: "rfp", topup: false }} />);
    expect(screen.getByRole("heading", { name: "How RFPs work" })).toBeInTheDocument();
    expect(screen.getByText(/^Rules v\d{4}-\d{2}, shown on every initiative/)).toBeInTheDocument();
    expect(screen.getByText(/30-day proposal window/)).toBeInTheDocument();
    rerender(<RulesPanel r={{ type: "grant", topup: false }} />);
    expect(screen.getByRole("heading", { name: "How grants work" })).toBeInTheDocument();
    expect(screen.getByText(/15-day window/)).toBeInTheDocument();
    expect(screen.queryByText(/challenge/i)).not.toBeInTheDocument();
    rerender(<RulesPanel r={{ type: "grant", topup: true }} />);
    expect(screen.getByRole("heading", { name: /How top-up grants work/ })).toBeInTheDocument();
    expect(screen.getByText(/no proposal window/)).toBeInTheDocument();
    expect(screen.queryByText(/challenge/i)).not.toBeInTheDocument();
  });
});

it("never renders a non-https recipient link as an anchor", () => {
  render(<KeyFacts r={{ ...base, recipientUrl: "javascript:alert(1)" }} summary={summary} />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText("Vyper core team")).toBeInTheDocument();
});
