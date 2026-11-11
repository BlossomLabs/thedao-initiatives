import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Tier } from "../../../shared/vote/ballot";
import TierBallot from "./TierBallot";

vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
afterEach(cleanup);

const items = ["alpha", "beta", "gamma"].map((slug) => ({ slug, title: slug.toUpperCase() }));

function show(tiers: Partial<Record<string, Tier>>, onChange = vi.fn(), onReplace = vi.fn()) {
  render(
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

it("a settled tier says so and takes nothing", () => {
  show({ alpha: "S" });
  expect(screen.getByRole("button", { name: "Must fund (settled)" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /^BETA/ }));
  expect(screen.getByRole("button", { name: "Must fund (settled)" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Place in Should fund" })).toBeEnabled();
});

it("an initiative in a settled tier can't be picked up or removed", () => {
  const { onChange } = show({ alpha: "S" });
  const chip = within(screen.getByRole("list", { name: "Must fund" })).getByRole("button", {
    name: "ALPHA",
  });
  expect(chip).toBeDisabled();
  fireEvent.click(chip);
  expect(screen.queryByRole("button", { name: /Remove ALPHA/ })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it("Clear ballot keeps a settled tier", () => {
  const { onReplace } = show({ alpha: "S", beta: "A" });
  fireEvent.click(screen.getByRole("button", { name: /clear ballot/i }));
  expect(onReplace).toHaveBeenCalledWith({ alpha: "S" });
});
