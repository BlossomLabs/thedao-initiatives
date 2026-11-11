import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { NextTierEntry } from "~/hooks/use-vote";
import { LeadFigure, NextTierFigure } from "./NextTier";

afterEach(cleanup);

const titles = new Map([["beta", "Beta audits"], ["gamma", "Gamma tools"], [
  "delta",
  "Delta docs",
]]);
const entry = (over: Partial<NextTierEntry> = {}): NextTierEntry => ({
  tier: "S",
  gap: "41200000000",
  comesIn: [],
  dropsOut: [],
  moves: [],
  ...over,
});

it("shows the gap to the next tier, rounded up", () => {
  render(<NextTierFigure next={entry()} titles={titles} />);
  // usdShort writes thousands with a lowercase k.
  expect(screen.getByRole("button", { name: "$42k to Tier-S" })).toBeInTheDocument();
  // A narrow column wraps before the tier, never inside "Tier-S".
  expect(screen.getByText("Tier-S")).toHaveClass("whitespace-nowrap");
});

it("out of reach", () => {
  render(<NextTierFigure next={entry({ gap: null, tier: "B" })} titles={titles} />);
  const tier = screen.getByText("Tier-B");
  expect(tier).toHaveClass("whitespace-nowrap");
  expect(tier.parentElement).toHaveTextContent("Out of reach for Tier-B");
  expect(screen.queryByRole("button")).toBeNull();
});

it("the hover lists who comes in and who drops out", () => {
  render(
    <NextTierFigure
      next={entry({
        comesIn: [{ slug: "beta", tier: "A" }],
        dropsOut: [{ slug: "gamma", tier: "B" }],
        moves: [{ slug: "delta", from: "A", to: "S" }],
      })}
      titles={titles}
    />,
  );
  const button = screen.getByRole("button");
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(button);
  const tip = screen.getByRole("tooltip");
  expect(button).toHaveAttribute("aria-describedby", tip.id);
  expect(tip).toHaveTextContent("With $42k more backing:");
  expect(tip).toHaveTextContent("Comes in: Beta audits (Tier-A)");
  expect(tip).toHaveTextContent("Drops out: Gamma tools (Tier-B)");
  expect(tip).toHaveTextContent("Moves: Delta docs Tier-A → Tier-S");
  fireEvent.keyDown(button, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("opens on hover and on tap, closes on blur", () => {
  render(<NextTierFigure next={entry()} titles={titles} />);
  const button = screen.getByRole("button");
  fireEvent.mouseEnter(button);
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
  fireEvent.mouseLeave(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(button);
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
  fireEvent.blur(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("nothing else changes", () => {
  render(<NextTierFigure next={entry()} titles={titles} />);
  fireEvent.focus(screen.getByRole("button"));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Nothing else changes.");
});

it("the hover first says where it stands now", () => {
  render(<NextTierFigure next={entry()} now="A" titles={titles} />);
  fireEvent.focus(screen.getByRole("button"));
  expect(screen.getByRole("tooltip").firstChild).toHaveTextContent("Now Tier-A.");
  cleanup();
  render(<NextTierFigure next={entry({ tier: "B" })} titles={titles} />);
  fireEvent.focus(screen.getByRole("button"));
  expect(screen.getByRole("tooltip").firstChild).toHaveTextContent("Now not funded.");
});

it("Tier-S shows how far ahead it is", () => {
  render(<LeadFigure lead="12400000000" />);
  const button = screen.getByRole("button", { name: "$12k ahead" });
  expect(button).toHaveClass("text-vote");
  fireEvent.focus(button);
  const tip = screen.getByRole("tooltip");
  expect(tip).toHaveTextContent(
    "Its backers could give this much less between them and it would still be funded in Tier-S.",
  );
  expect(screen.getByText("Tier-S")).toHaveClass("whitespace-nowrap");
  fireEvent.keyDown(button, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("a lead under $1K shows nothing", () => {
  const { container } = render(<LeadFigure lead="999999999" />);
  expect(container).toBeEmptyDOMElement();
});

it("after the vote, the hover names the target tier", () => {
  render(
    <NextTierFigure
      final
      next={entry({
        comesIn: [{ slug: "beta", tier: "S" }],
        dropsOut: [{ slug: "gamma", tier: "S" }],
      })}
      now="A"
      titles={titles}
    />,
  );
  fireEvent.focus(screen.getByRole("button", { name: "$42k to Tier-S" }));
  const tip = screen.getByRole("tooltip");
  expect(tip).toHaveTextContent("With $42k more backing it would have made Tier-S:");
  expect(tip).toHaveTextContent("Comes into Tier-S: Beta audits");
  expect(tip).toHaveTextContent("Drops out of Tier-S: Gamma tools");
  expect(tip).not.toHaveTextContent("Now");
});

it("a label replaces the trigger text", () => {
  render(<NextTierFigure final label="needed $30k" next={entry({ tier: "B" })} titles={titles} />);
  fireEvent.focus(screen.getByRole("button", { name: "needed $30k" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Nothing else changes.");
});
