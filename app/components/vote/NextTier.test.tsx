import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { NextTierEntry } from "~/hooks/use-vote";
import { whatIf, WhatIfCallout, WhatIfFigure, whatIfText, whatIfTick } from "./NextTier";

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
const gapOf = (over: Partial<NextTierEntry> = {}) => ({ kind: "gap" as const, next: entry(over) });

it("S-Tier says its lead (from $1K), any other tier its gap", () => {
  expect(whatIf({ tier: "S", lead: "12400000000", next: entry() })).toEqual({
    kind: "lead",
    amount: 12_400,
  });
  // Under one $1K step there is nothing to say; S-Tier has nothing above it.
  expect(whatIf({ tier: "S", lead: "999999999" })).toBeNull();
  expect(whatIf({ tier: "S", next: entry() })).toBeNull();
  expect(whatIf({ tier: "A", next: entry() })).toEqual(gapOf());
  expect(whatIf({ next: entry({ tier: "B" }) })).toEqual(gapOf({ tier: "B" }));
  expect(whatIf({ tier: "A" })).toBeNull();
});

it("the tick sits at raised plus the gap, on the ask's scale, capped at the end", () => {
  // Raised $0, ask $44k, $23k to S-Tier: 52.3%.
  expect(whatIfTick(gapOf({ gap: "23000000000" }), 0, 44_000)).toBeCloseTo(52.27, 1);
  expect(whatIfTick(gapOf({ gap: "23000000000" }), 10_000, 44_000)).toBeCloseTo(75, 5);
  expect(whatIfTick(gapOf({ gap: "90000000000" }), 0, 44_000)).toBe(100);
  // No tick out of reach, for a lead, or without an ask.
  expect(whatIfTick(gapOf({ gap: null }), 0, 44_000)).toBeUndefined();
  expect(whatIfTick({ kind: "lead", amount: 46_000 }, 0, 44_000)).toBeUndefined();
  expect(whatIfTick(gapOf(), 0, 0)).toBeUndefined();
  expect(whatIfTick(null, 0, 44_000)).toBeUndefined();
});

it("the figure is plain text: the value big, the words small, rounded up", () => {
  const { container } = render(<WhatIfFigure w={gapOf()} />);
  // usdShort writes thousands with a lowercase k.
  expect(container).toHaveTextContent("$42k to S-Tier");
  expect(screen.getByText("$42k").tagName).toBe("B");
  expect(screen.getByText("S-Tier")).toHaveClass("whitespace-nowrap");
  expect(screen.getByText("S-Tier").closest("small")).not.toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(container.querySelector(".cursor-help, .underline, .decoration-dotted")).toBeNull();
});

it("out of reach and a lead read as plain text too", () => {
  const { container, rerender } = render(<WhatIfFigure w={gapOf({ gap: null, tier: "B" })} />);
  expect(container).toHaveTextContent("Out of reach for B-Tier");
  expect(screen.getByText("B-Tier")).toHaveClass("whitespace-nowrap");
  rerender(<WhatIfFigure w={{ kind: "lead", amount: 12_400 }} />);
  expect(container).toHaveTextContent("$12k ahead");
  expect(screen.queryByRole("button")).toBeNull();
  expect(container.querySelector(".cursor-help, .underline, .decoration-dotted")).toBeNull();
});

it("during the vote the callout lists who comes in, drops out or moves", () => {
  const { container } = render(
    <div className="relative">
      <WhatIfCallout
        w={gapOf({
          comesIn: [{ slug: "beta", tier: "A" }],
          dropsOut: [{ slug: "gamma", tier: "B" }],
          moves: [{ slug: "delta", from: "A", to: "S" }],
        })}
        at={30}
        side="bottom"
        titles={titles}
      />
    </div>,
  );
  const callout = container.querySelector("[data-vote-callout]") as HTMLElement;
  expect(callout).toHaveTextContent("$42k to S-Tier");
  expect(callout).toHaveTextContent("Comes in: Beta audits (A-Tier)");
  expect(callout).toHaveTextContent("Drops out: Gamma tools (B-Tier)");
  expect(callout).toHaveTextContent("Moves: Delta docs A-Tier → S-Tier");
  expect(callout).not.toHaveTextContent("Nothing else changes.");
  // Its arrow on the tick: anchored 14px in from its left.
  expect(callout.style.left).toBe("calc(30% - 14px)");
});

it("nothing else changes", () => {
  render(<WhatIfCallout w={gapOf()} at={30} side="top" titles={titles} />);
  expect(screen.getByText("Nothing else changes.")).toBeInTheDocument();
});

it("after the vote, the callout names the target tier", () => {
  const { container } = render(
    <WhatIfCallout
      final
      w={gapOf({
        comesIn: [{ slug: "beta", tier: "S" }],
        dropsOut: [{ slug: "gamma", tier: "S" }],
      })}
      at={30}
      side="top"
      titles={titles}
    />,
  );
  const callout = container.querySelector("[data-vote-callout]")!;
  expect(callout).toHaveTextContent("Comes into S-Tier: Beta audits");
  expect(callout).toHaveTextContent("Drops out of S-Tier: Gamma tools");
});

it("a lead's callout sits at the bar's end and says what it means", () => {
  const { container } = render(
    <WhatIfCallout w={{ kind: "lead", amount: 46_000 }} side="bottom" titles={titles} />,
  );
  const callout = container.querySelector("[data-vote-callout]") as HTMLElement;
  expect(callout).toHaveTextContent("$46k ahead");
  expect(callout).toHaveTextContent(
    "Its backers could give this much less between them and it would still be funded in S-Tier.",
  );
  // At the end, anchored on its right so it opens back over the bar.
  expect(callout.style.right).toBe("calc(0% - 14px)");
  expect(callout.style.left).toBe("");
});

it("out of reach: the callout at the bar's end, no knock-on", () => {
  const { container } = render(
    <WhatIfCallout w={gapOf({ gap: null, tier: "B" })} side="bottom" titles={titles} />,
  );
  const callout = container.querySelector("[data-vote-callout]") as HTMLElement;
  expect(callout).toHaveTextContent("Out of reach for B-Tier");
  expect(callout).not.toHaveTextContent("Nothing else changes.");
  expect(callout.style.right).toBe("calc(0% - 14px)");
});

it("screen readers hear the same in one go", () => {
  expect(whatIfText(gapOf({ dropsOut: [{ slug: "gamma", tier: "S" }] }), titles, true)).toBe(
    "$42k to S-Tier. Drops out of S-Tier: Gamma tools.",
  );
  expect(whatIfText(gapOf(), titles, false)).toBe("$42k to S-Tier. Nothing else changes.");
  expect(whatIfText({ kind: "lead", amount: 46_000 }, titles, false)).toBe(
    "$46k ahead. Its backers could give this much less between them and it would still be funded in S-Tier.",
  );
  expect(whatIfText(gapOf({ gap: null, tier: "B" }), titles, false)).toBe(
    "Out of reach for B-Tier.",
  );
});
