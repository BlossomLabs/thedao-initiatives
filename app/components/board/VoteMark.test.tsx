import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useVoteReveal, VoteCallout, voteCallout } from "./VoteMark";

const vote = { show: true, floorPct: 25, capUsd: 200_000 };

it("the callout: past the floor, or what is missing within 5 points of it", () => {
  // goal $600k, floor 25% = $150k
  expect(voteCallout(118_000, 600_000, vote)).toBeNull(); // 5.3 points short
  expect(voteCallout(121_000, 600_000, vote)).toEqual({ kind: "near", missing: 29_000 });
  expect(voteCallout(150_000, 600_000, vote)).toEqual({ kind: "eligible" });
  expect(voteCallout(150_000, 600_000, { ...vote, show: false })).toBeNull();
});

it("the callout says how much is missing, short and rounded up, or First goal reached", () => {
  const { rerender } = render(
    <VoteCallout state={{ kind: "near", missing: 1_950 }} at={25} side="top" />,
  );
  expect(screen.getByText("$2k to first goal")).toBeInTheDocument();
  rerender(<VoteCallout state={{ kind: "eligible" }} at={25} side="top" />);
  expect(screen.getByText("First goal reached")).toBeInTheDocument();
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
