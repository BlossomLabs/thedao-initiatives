import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { useState } from "react";
import type { Tier } from "../../../shared/vote/ballot";
import TierBallot from "./TierBallot";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
afterEach(cleanup);

// The info card's Details is a router link.
const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** The card's selector: opens it and picks an option by its read-out name. */
async function pickIn(card: HTMLElement, name: string) {
  const trigger = within(card).getByRole("combobox");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name });
  // Keyboard, as Base UI ignores a click that lands the instant the list opens.
  const list = screen.getByRole("listbox");
  for (const key of ["ArrowDown", "ArrowUp"]) {
    for (let i = 0; i < 6 && !option.hasAttribute("data-highlighted"); i++) {
      fireEvent.keyDown(list, { key });
      await waitFor(() => {}, { timeout: 20 }).catch(() => {});
    }
  }
  fireEvent.keyDown(option, { key: "Enter" });
}
/** Opens the card's selector and returns its options. */
async function optionsIn(card: HTMLElement) {
  const trigger = within(card).getByRole("combobox");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("listbox");
  return (name: string) => screen.getByRole("option", { name });
}

const items = ["alpha", "beta", "gamma"].map((slug) => ({ slug, title: slug.toUpperCase() }));

function show(tiers: Partial<Record<string, Tier>>, onChange = vi.fn(), onReplace = vi.fn()) {
  inRouter(
    <TierBallot
      items={items}
      tiers={tiers}
      disabled={false}
      locked={new Set<Tier>(["S"])}
      onChange={onChange}
      onReplace={onReplace}
    />,
  );
  return { onChange, onReplace };
}

it("Details on a list tile opens its card, as a tap on the tile does", async () => {
  show({});
  fireEvent.click(screen.getByRole("button", { name: "Details for BETA" }));
  expect(await screen.findByRole("dialog", { name: "BETA" })).toBeInTheDocument();
});

it("a settled tier says so, and its card locks the choices", async () => {
  const { onChange } = show({ alpha: "S" });
  expect(screen.getByText("Settled")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Details for BETA" }));
  const card = await screen.findByRole("dialog", { name: "BETA" });
  expect(card.querySelector("[data-peek-place]")).toHaveTextContent("Not ranked yet");
  const option = await optionsIn(card);
  expect(option("S-Tier, Must fund")).toHaveAttribute("aria-disabled", "true");
  expect(option("A-Tier, Should fund")).not.toHaveAttribute("aria-disabled", "true");
  expect(onChange).not.toHaveBeenCalled();
});

it("an initiative in a settled tier opens its card, but nothing in it moves it", async () => {
  const { onChange } = show({ alpha: "S" });
  fireEvent.click(
    within(screen.getByRole("list", { name: "Must fund" })).getByRole("button", { name: "ALPHA" }),
  );
  const card = await screen.findByRole("dialog", { name: "ALPHA" });
  expect(within(card).queryByRole("combobox", { name: /^Change where/ })).toBeNull();
  // Why, in a popover on the selector, not in the card's text.
  expect(card).not.toHaveTextContent("has settled");
  fireEvent.click(within(card).getByLabelText("S-Tier has settled."));
  expect(await screen.findByText("S-Tier has settled.", { selector: "[data-peek-note]" }))
    .toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("Clear ballot keeps a settled tier", () => {
  const { onReplace } = show({ alpha: "S", beta: "A" });
  fireEvent.click(screen.getByRole("button", { name: /clear ballot/i }));
  expect(onReplace).toHaveBeenCalledWith({ alpha: "S" });
});

it("a settled chip says what this badge paid for it", () => {
  inRouter(
    <TierBallot
      items={items}
      tiers={{ alpha: "S", beta: "S" }}
      disabled={false}
      locked={new Set<Tier>(["S"])}
      funded={new Set(["alpha"])}
      paid={new Map([["alpha", 900]])}
      onChange={vi.fn()}
    />,
  );
  const list = within(screen.getByRole("list", { name: "Must fund" }));
  expect(list.getByRole("button", { name: "ALPHA, funded: your share paid $900" }))
    .toHaveTextContent(
      "$900",
    );
  expect(list.getByRole("button", { name: "BETA, not funded" })).toBeInTheDocument();
});

const NOTE = "Your S-Tier picks that weren't funded stay first in line for what you have left.";

function settled(tiers: Partial<Record<string, Tier>>) {
  render(
    <TierBallot
      items={items}
      tiers={tiers}
      disabled={false}
      locked={new Set<Tier>(["S"])}
      funded={new Set(["alpha"])}
      onChange={vi.fn()}
    />,
  );
  return screen.getByRole("list", { name: "Must fund" }).parentElement!;
}

it("hovering a settled tier with picks that weren't funded says they stay first in line", async () => {
  const row = settled({ alpha: "S", beta: "S" });
  expect(screen.queryByText(NOTE)).toBeNull();
  fireEvent.pointerEnter(row, { pointerType: "mouse" });
  fireEvent.mouseEnter(row);
  fireEvent.pointerMove(row, { pointerType: "mouse" });
  fireEvent.mouseMove(row);
  expect(await screen.findByText(NOTE, {}, { timeout: 2000 })).toBeInTheDocument();
});

it("no hover note when every settled pick was funded", async () => {
  const row = settled({ alpha: "S" });
  fireEvent.pointerEnter(row, { pointerType: "mouse" });
  fireEvent.mouseEnter(row);
  fireEvent.mouseMove(row);
  await new Promise((r) => setTimeout(r, 500));
  expect(screen.queryByText(/weren't funded/)).toBeNull();
});

it("a tap on the settled tier shows the note too (phones can't hover); a tap elsewhere hides it", async () => {
  const row = settled({ alpha: "S", beta: "S" });
  fireEvent.click(row);
  expect(await screen.findByText(NOTE)).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByText(NOTE)).toBeNull());
});

it("a settled A-Tier with picks that weren't funded has its own note", async () => {
  render(
    <TierBallot
      items={items}
      tiers={{ alpha: "S", beta: "A" }}
      disabled={false}
      locked={new Set<Tier>(["S", "A"])}
      funded={new Set(["alpha"])}
      onChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("list", { name: "Should fund" }).parentElement!);
  expect(
    await screen.findByText(
      "Your A-Tier picks that weren't funded stay ahead of B-Tier for what you have left.",
    ),
  ).toBeInTheDocument();
});

it("the Clear ballot row says that a tier's initiatives are equal, even with nothing placed", () => {
  render(
    <TierBallot items={items} tiers={{}} disabled={false} onChange={vi.fn()} onReplace={vi.fn()} />,
  );
  expect(screen.getByText("Initiatives in the same tier are ranked equally.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /clear ballot/i })).toBeNull();
});

it("a tap on a chip opens its card; a choice there moves it, Details opens the page", async () => {
  const { onChange } = show({ alpha: "S", beta: "A" });
  fireEvent.click(screen.getByRole("button", { name: "BETA" }));
  const card = await screen.findByRole("dialog", { name: "BETA" });
  expect(card.querySelector("[data-peek-place]")).toHaveTextContent("A-Tier · Should fund");
  const details = within(card).getByRole("link", { name: /Open full page for BETA/ });
  expect(details).toHaveAttribute("href", "/initiative/beta");
  expect(details).toHaveAttribute("target", "_blank");
  expect(onChange).not.toHaveBeenCalled();
  await pickIn(card, "B-Tier, Nice to have");
  expect(onChange).toHaveBeenCalledWith("beta", "B");
  // The card stays open; Escape closes it.
  expect(screen.getByRole("dialog", { name: "BETA" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("Escape closes the card without moving anything, and focus goes back to the chip", async () => {
  const { onChange } = show({ beta: "A" });
  fireEvent.click(screen.getByRole("button", { name: "BETA" }));
  await screen.findByRole("dialog", { name: "BETA" });
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "BETA" })).toHaveFocus();
  expect(onChange).not.toHaveBeenCalled();
});

it("a settled chip's card says whether it was funded", async () => {
  inRouter(
    <TierBallot
      items={items}
      tiers={{ alpha: "S" }}
      disabled={false}
      locked={new Set<Tier>(["S"])}
      funded={new Set(["alpha"])}
      paid={new Map([["alpha", 900]])}
      onChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^ALPHA/ }));
  const card = await screen.findByRole("dialog", { name: "ALPHA" });
  fireEvent.click(within(card).getByLabelText("S-Tier has settled. You paid $900."));
  expect(
    await screen.findByText("S-Tier has settled. You paid $900.", { selector: "[data-peek-note]" }),
  ).toBeInTheDocument();
});

it("Details on a list tile opens the same card; Not ranked is chosen, a tier places it", async () => {
  const { onChange } = show({});
  fireEvent.click(screen.getByRole("button", { name: "Details for GAMMA" }));
  const card = await screen.findByRole("dialog", { name: "GAMMA" });
  expect(card.querySelector("[data-peek-place]")).toHaveTextContent("Not ranked yet");
  await pickIn(card, "A-Tier, Should fund");
  expect(onChange).toHaveBeenCalledWith("gamma", "A");
  expect(screen.queryByRole("button", { name: /preview for|Info on/ })).toBeNull();
});

function withSkips(skipped: string[], tiers: Partial<Record<string, Tier>> = {}) {
  const onChange = vi.fn();
  const onSkip = vi.fn();
  inRouter(
    <TierBallot
      items={items}
      tiers={tiers}
      disabled={false}
      skipped={new Set(skipped)}
      onSkip={onSkip}
      onChange={onChange}
    />,
  );
  return { onChange, onSkip };
}

it("Skip on the card takes an initiative off the list (a tiered one leaves its tier too)", async () => {
  const { onChange, onSkip } = withSkips([], { alpha: "A" });
  fireEvent.click(screen.getByRole("button", { name: "Details for GAMMA" }));
  let card = await screen.findByRole("dialog", { name: "GAMMA" });
  await pickIn(card, "Skip: hide it from the list");
  expect(onSkip).toHaveBeenCalledWith("gamma", true);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  fireEvent.click(screen.getByRole("button", { name: "ALPHA" }));
  card = await screen.findByRole("dialog", { name: "ALPHA" });
  await pickIn(card, "Skip: hide it from the list");
  expect(onChange).toHaveBeenCalledWith("alpha", undefined);
  expect(onSkip).toHaveBeenCalledWith("alpha", true);
});

it("skipped initiatives are hidden, counted, and shown on demand; a tier brings one back", async () => {
  const { onChange, onSkip } = withSkips(["gamma"]);
  const list = screen.getByRole("list", { name: "Not ranked yet" });
  expect(within(list).queryByText("GAMMA")).toBeNull();
  const toggle = screen.getByRole("button", { name: "Show 1 skipped and low-rated" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("list", { name: "Skipped" })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const hidden = screen.getByRole("list", { name: "Skipped" });
  fireEvent.click(within(hidden).getByRole("button", { name: "Details for GAMMA" }));
  const card = await screen.findByRole("dialog", { name: "GAMMA" });
  expect(card.querySelector("[data-peek-place]")).toHaveTextContent("Skipped");
  await pickIn(card, "B-Tier, Nice to have");
  expect(onSkip).toHaveBeenCalledWith("gamma", false);
  expect(onChange).toHaveBeenCalledWith("gamma", "B");
});

it("without onSkip there is no Skip and no skipped list", async () => {
  show({});
  fireEvent.click(screen.getByRole("button", { name: "Details for GAMMA" }));
  const card = await screen.findByRole("dialog", { name: "GAMMA" });
  expect(within(card).queryByRole("button", { name: /Skip/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /skipped/ })).toBeNull();
});

it("every tile in the list has a quick Skip; a skipped one has Unskip", () => {
  const { onChange, onSkip } = withSkips(["beta"], { alpha: "S" });
  // Tiered initiatives are chips: no quick Skip there.
  expect(screen.queryByRole("button", { name: "Skip ALPHA" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Skip GAMMA" }));
  expect(onSkip).toHaveBeenCalledWith("gamma", true);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Show 1 skipped/ }));
  fireEvent.click(screen.getByRole("button", { name: "Unskip BETA" }));
  expect(onSkip).toHaveBeenCalledWith("beta", false);
  expect(onChange).toHaveBeenCalledWith("beta", undefined);
});

it("‹ › step through the ballot in order: S-Tier, A-Tier, B-Tier, then the list (no counter)", async () => {
  const { onChange } = show({ gamma: "S", alpha: "B" });
  fireEvent.click(screen.getByRole("button", { name: "GAMMA" }));
  let card = await screen.findByRole("dialog", { name: "GAMMA" });
  expect(card).not.toHaveTextContent("1 / 3"); // no counter
  expect(within(card).getByRole("button", { name: "Previous initiative" })).toBeDisabled();
  fireEvent.click(within(card).getByRole("button", { name: "Next initiative" }));
  card = await screen.findByRole("dialog", { name: "ALPHA" });
  expect(card.querySelector("[data-peek-place]")).toHaveTextContent("B-Tier · Nice to have");
  // The arrow keys too; the list comes last.
  fireEvent.keyDown(document, { key: "ArrowRight" });
  card = await screen.findByRole("dialog", { name: "BETA" });
  expect(within(card).getByRole("button", { name: "Next initiative" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "ArrowLeft" });
  expect(await screen.findByRole("dialog", { name: "ALPHA" })).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

/** A ballot that keeps its own tiers, as the page does. */
function Live({ start }: { start: Partial<Record<string, Tier>> }) {
  const [tiers, setTiers] = useState(start);
  return (
    <TierBallot
      items={items}
      tiers={tiers}
      disabled={false}
      onChange={(slug, t) =>
        setTiers((p) => {
          const next = { ...p, [slug]: t };
          if (!t) delete next[slug];
          return next;
        })}
    />
  );
}

it("a choice on the card moves the initiative but keeps the card open, and ‹ › keep their order", async () => {
  inRouter(<Live start={{ alpha: "S", beta: "A" }} />);
  fireEvent.click(screen.getByRole("button", { name: "ALPHA" }));
  let card = await screen.findByRole("dialog", { name: "ALPHA" });
  // S-Tier to B-Tier: on the page ALPHA now comes after BETA, but the card's order holds.
  await pickIn(card, "B-Tier, Nice to have");
  card = screen.getByRole("dialog", { name: "ALPHA" });
  await waitFor(() =>
    expect(card.querySelector("[data-peek-place]")).toHaveTextContent("B-Tier · Nice to have")
  );
  expect(within(screen.getByRole("list", { name: "Nice to have" })).getByText("ALPHA"))
    .toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: "Next initiative" }));
  expect(await screen.findByRole("dialog", { name: "BETA" })).toBeInTheDocument();
});
