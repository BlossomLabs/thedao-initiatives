import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { VoteBrief } from "../../../shared/vote/brief";
import BriefList, { askText, PledgerStack } from "./BriefList";

const state = vi.hoisted(() => ({
  q: { isPending: false, data: {} as Record<string, unknown> } as {
    isPending: boolean;
    data?: Record<string, unknown>;
  },
}));
vi.mock("~/hooks/use-vote-briefs", () => ({ useVoteBriefs: () => state.q }));
afterEach(cleanup);

const brief: VoteBrief = {
  what: [
    { title: "Verified EVM", text: "Builds a verified EVM." },
    { title: "zkVM releases", text: "Ships it to zkVM teams." },
  ],
  adoption: ["Two clients must run it", "or 20% of nodes"],
  goalUsd: 370_000,
  adoptionUsd: 125_000,
};
const item = {
  slug: "evm",
  title: "Verified EVM",
  askUsd: 303_000,
  card: {
    initiative: { summary: "The long summary.", goalUsd: 370_000 },
    logos: [
      { company: "Acme", logoUrl: "https://logo.example/acme.png", url: "" },
      { company: "Beta", logoUrl: "", url: "" },
    ],
  },
} as unknown as Parameters<typeof BriefList>[0]["item"];

it("shows what it delivers under bold titles, Adoption with its conditions, then paid on adoption", () => {
  state.q = { isPending: false, data: { evm: brief } };
  render(<BriefList item={item} />);
  const list = screen.getAllByRole("list")[0];
  const top = [...list.children].map((li) => li.textContent);
  expect(top).toEqual([
    "Verified EVM: Builds a verified EVM.",
    "zkVM releases: Ships it to zkVM teams.",
    "Adoption:Two clients must run itor 20% of nodes",
    "Paid on adoption: 34% ($125,000 of $370,000)",
  ]);
  const sub = screen.getAllByRole("list")[1];
  expect([...sub.children].map((li) => li.textContent)).toEqual([
    "Two clients must run it",
    "or 20% of nodes",
  ]);
  expect(screen.queryByText("The long summary.")).toBeNull();
});

it("falls back to the summary when the initiative has no brief", () => {
  state.q = { isPending: false, data: {} };
  render(<BriefList item={item} />);
  expect(screen.getByText("The long summary.")).toBeTruthy();
});

it("shows a loading placeholder, not the summary, while the briefs load", () => {
  state.q = { isPending: true };
  render(<BriefList item={item} />);
  expect(screen.getByLabelText("Loading")).toBeTruthy();
  expect(screen.queryByText("The long summary.")).toBeNull();
});

it("the header gives the ask beside the goal, and the pledgers as small logos", () => {
  expect(askText(item)).toBe("$303,000 ask (82% of goal)");
  expect(askText({ ...item, askUsd: undefined })).toBe("");
  render(<PledgerStack item={item} />);
  expect(screen.getByRole("img", { name: "Pledged by Acme, Beta" })).toBeTruthy();
});
