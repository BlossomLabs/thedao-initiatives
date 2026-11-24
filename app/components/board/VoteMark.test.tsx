import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  calloutLabel,
  calloutText,
  useVoteReveal,
  VoteCallout,
  voteCallout,
  voteStanding,
} from "./VoteMark";

const vote = { show: true, floorPct: 25, capUsd: 200_000, qualifyBy: null };

it("the callout: past the floor, or what is missing within 5 points of it", () => {
  // goal $240k, floor 25% = $60k
  expect(voteCallout(47_000, 240_000, vote)).toBeNull(); // 5.4 points short
  expect(voteCallout(49_000, 240_000, vote)).toEqual({ kind: "near", missing: 11_000 });
  expect(voteCallout(60_000, 240_000, vote)).toEqual({ kind: "eligible" });
  expect(voteCallout(60_000, 240_000, { ...vote, show: false })).toBeNull();
  // goal $600k: the floor is the goal less the $200k cap, $400k
  expect(voteCallout(150_000, 600_000, vote)).toBeNull();
  expect(voteCallout(380_000, 600_000, vote)).toEqual({
    kind: "near",
    missing: 20_000,
    cap: { usd: 200_000, pct: 67 },
  });
  expect(voteCallout(400_000, 600_000, vote)).toEqual({ kind: "eligible" });
});

it("the callout says how much is missing, short and rounded up, or Qualified for the vote", () => {
  const { rerender } = render(
    <VoteCallout state={{ kind: "near", missing: 1_950 }} at={25} side="top" />,
  );
  expect(screen.getByText("$2k to qualify")).toBeInTheDocument();
  rerender(<VoteCallout state={{ kind: "eligible" }} at={25} side="top" />);
  expect(screen.getByText("Qualified for the vote")).toBeInTheDocument();
});

it("a goal over the cap says why it qualifies further along, and grows leftwards", () => {
  // $260k is still under the cap's reach: 25% ($65k) is more than $260k − $200k.
  expect(voteStanding(10_000, 260_000, vote)).toEqual({ kind: "near", missing: 55_000 });
  // $500k qualifies at $300k, 60% of its goal.
  const state = voteStanding(180_000, 500_000, vote)!;
  expect(calloutLabel(state)).toBe("$120k to qualify · $200k max from TheDAO");
  expect(calloutText(state)).toBe(
    "$120k to qualify for TheDAO's vote: TheDAO gives at most $200,000 to one initiative, so this one qualifies at 60% of its goal",
  );
  const { container } = render(<VoteCallout state={state} at={60} side="top" />);
  expect(screen.getByText("$120k to qualify · $200k max from TheDAO")).toBeInTheDocument();
  expect((container.querySelector("[data-vote-callout]") as HTMLElement).style.right).toBe(
    "calc(40% - 14px)",
  );
});

it("on the ballot: the callout shows even below the floor, in its own words", () => {
  expect(voteCallout(10, 100, vote, true)).toEqual({ kind: "ballot" });
  expect(voteStanding(10, 100, vote, true)).toEqual({ kind: "ballot" });
  expect(voteCallout(10, 100, { ...vote, show: false }, true)).toBeNull();
  expect(calloutLabel({ kind: "ballot" })).toBe("On the ballot");
  expect(calloutText({ kind: "ballot" })).toBe("On the ballot for TheDAO's vote");
  render(<VoteCallout state={{ kind: "ballot" }} at={25} side="top" />);
  expect(screen.getByText("On the ballot")).toBeInTheDocument();
});

function Row() {
  const { open, handlers } = useVoteReveal(true);
  return (
    <div data-testid="row" {...handlers}>
      <a href="#x">Title</a>
      {open && <span>callout</span>}
    </div>
  );
}

it("the whole row shows the callout: a mouse on it, a tap on it, or the keyboard inside it", () => {
  render(
    <>
      <Row />
      <p>elsewhere</p>
    </>,
  );
  const row = screen.getByTestId("row");
  const shown = () => screen.queryByText("callout") !== null;
  expect(shown()).toBe(false);
  fireEvent.pointerEnter(row, { pointerType: "mouse" });
  expect(shown()).toBe(true);
  fireEvent.pointerLeave(row, { pointerType: "mouse" });
  expect(shown()).toBe(false);
  // A tap: the row, not its link (which keeps navigating); a tap elsewhere or Esc hides it.
  fireEvent.click(screen.getByText("Title"));
  expect(shown()).toBe(false);
  fireEvent.click(row);
  expect(shown()).toBe(true);
  fireEvent.pointerDown(screen.getByText("elsewhere"));
  expect(shown()).toBe(false);
  fireEvent.click(row);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(shown()).toBe(false);
  fireEvent.focus(screen.getByText("Title"));
  expect(shown()).toBe(true);
});

it("after the deadline to qualify, only one on the ballot keeps its callout", () => {
  const closed = { ...vote, qualifyBy: 1000 };
  // Before it: as ever.
  expect(voteCallout(60_000, 240_000, closed, false, 999)).toEqual({ kind: "eligible" });
  expect(voteStanding(10, 240_000, closed, false, 999)).toEqual({ kind: "near", missing: 59_990 });
  expect(voteCallout(60_000, 240_000, closed, false, 1000)).toBeNull();
  expect(voteCallout(59_000, 240_000, closed, false, 1000)).toBeNull();
  expect(voteStanding(60_000, 240_000, closed, false, 1000)).toBeNull();
  expect(voteCallout(10, 100, closed, true, 1000)).toEqual({ kind: "ballot" });
  expect(voteStanding(10, 100, closed, true, 1000)).toEqual({ kind: "ballot" });
});
