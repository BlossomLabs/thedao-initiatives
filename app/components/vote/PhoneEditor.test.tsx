import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { useState } from "react";
import type { Tier } from "../../../shared/vote/ballot";
import TierBallot, { type PhoneParts } from "./TierBallot";
import { SWIPE_PX, swipeStep } from "./PhoneCard";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));

// A phone: every media query matches (the editor asks only for the phone's).
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const items = ["alpha", "beta", "gamma"].map((slug) => ({ slug, title: slug.toUpperCase() }));

function Ballot(
  { start = {}, parts = {} }: {
    start?: Partial<Record<string, Tier>>;
    parts?: Partial<PhoneParts>;
  },
) {
  const [tiers, setTiers] = useState(start);
  return (
    <MemoryRouter>
      <TierBallot
        items={items}
        tiers={tiers}
        disabled={false}
        onChange={(slug, t) =>
          setTiers((x) => {
            const next = { ...x };
            if (t) next[slug] = t;
            else delete next[slug];
            return next;
          })}
        actions={<p>Send panel</p>}
        phone={{
          head: <p>Ballot box</p>,
          round: <span>S-Tier starts settling</span>,
          roundSheet: <p>Round box</p>,
          send: { label: "Send my ballot", ready: true, summary: <p>Summary</p> },
          ...parts,
        }}
      />
    </MemoryRouter>
  );
}

it("lists the tiers, then the initiatives not ranked yet", () => {
  render(<Ballot start={{ beta: "A" }} />);
  expect(screen.getByText("Ballot box")).toBeInTheDocument();
  const a = screen.getByRole("list", { name: "A-Tier" });
  expect(within(a).getByText("BETA")).toBeInTheDocument();
  expect(screen.getByText("Nothing in S-Tier yet. Tap an initiative to place it."))
    .toBeInTheDocument();
  const rest = screen.getByRole("list", { name: "Not ranked yet" });
  expect(within(rest).getByText("ALPHA")).toBeInTheDocument();
  expect(within(rest).queryByText("BETA")).toBeNull();
});

it("places an initiative from its card and stays on it", () => {
  render(<Ballot />);
  fireEvent.click(screen.getByRole("button", { name: /ALPHA/ }));
  const card = screen.getByRole("dialog", { name: "ALPHA" });
  expect(within(card).getByText("1 of 3")).toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: "S-Tier, Must fund" }));
  // Still ALPHA's card, now in S-Tier.
  expect(screen.getByRole("dialog", { name: "ALPHA" })).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "S-Tier, Must fund" }))
    .toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(card).getByRole("button", { name: "Back to the list" }));
  expect(within(screen.getByRole("list", { name: "S-Tier" })).getByText("ALPHA"))
    .toBeInTheDocument();
});

it("swipes to the next initiative in the order the list showed", () => {
  render(<Ballot />);
  fireEvent.click(screen.getByRole("button", { name: /ALPHA/ }));
  const article = screen.getByRole("heading", { name: "ALPHA" }).closest("article")!;
  fireEvent.pointerDown(article, { pointerId: 1, clientX: 300, clientY: 400 });
  fireEvent.pointerMove(article, { pointerId: 1, clientX: 280, clientY: 402 });
  fireEvent.pointerMove(article, { pointerId: 1, clientX: 180, clientY: 404 });
  fireEvent.pointerUp(article, { pointerId: 1, clientX: 180, clientY: 404 });
  expect(screen.getByRole("dialog", { name: "BETA" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous initiative" }));
  expect(screen.getByRole("dialog", { name: "ALPHA" })).toBeInTheDocument();
});

it("tells a swipe from a short drag, and stops at the ends", () => {
  expect(swipeStep(-SWIPE_PX, 0, 3)).toBe(1);
  expect(swipeStep(SWIPE_PX, 1, 3)).toBe(-1);
  expect(swipeStep(-SWIPE_PX + 1, 0, 3)).toBe(0);
  expect(swipeStep(SWIPE_PX, 0, 3)).toBe(0);
  expect(swipeStep(-SWIPE_PX, 2, 3)).toBe(0);
});

it("opens the send sheet, or says why it can't", () => {
  const onBlocked = vi.fn();
  const { unmount } = render(<Ballot />);
  fireEvent.click(screen.getByRole("button", { name: "Send my ballot" }));
  const sheet = screen.getByRole("dialog", { name: "Send my ballot" });
  expect(within(sheet).getByText("Summary")).toBeInTheDocument();
  expect(within(sheet).getByText("Send panel")).toBeInTheDocument();
  unmount();
  render(
    <Ballot parts={{ send: { label: "Send my ballot", ready: false }, onBlocked }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Send my ballot" }));
  expect(onBlocked).toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("opens the round box from the deadline", () => {
  render(<Ballot />);
  fireEvent.click(screen.getByRole("button", { name: "S-Tier starts settling" }));
  expect(within(screen.getByRole("dialog", { name: "Where the round is" })).getByText("Round box"))
    .toBeInTheDocument();
});
