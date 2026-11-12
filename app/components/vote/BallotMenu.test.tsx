import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import BallotMenu from "./BallotMenu";

afterEach(cleanup);
const slugs = ["alpha", "beta", "gamma"];
const show = (
  onApply = vi.fn(() => false),
  tiers: Record<string, "S" | "A" | "B"> = { alpha: "S" },
) => {
  render(
    <BallotMenu
      slugs={slugs}
      titles={(s) => s.toUpperCase()}
      askUsd={() => 1_000_000n}
      tiers={tiers}
      onApply={onApply}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Use an LLM…" }));
  return { onApply, dialog: screen.getByRole("dialog", { name: "Build your ballot with an LLM" }) };
};

it("one button opens it: what to give the LLM, and where to paste its answer", () => {
  const { dialog } = show();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(within(dialog).getByRole("region", { name: "Give the LLM" })).toHaveTextContent(
    "The guide",
  );
  expect(within(dialog).getByText("1 initiative in 1 tier: to start from it")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "open it" })).toHaveAttribute(
    "href",
    "/vote/llms.txt",
  );
  expect(within(dialog).getByLabelText("Paste its ballot")).toBeInTheDocument();
});

it("copies the guide's link and this ballot, each saying so on its own button", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const { dialog } = show();
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy the guide's link" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/vote/llms.txt`));
  expect(
    await within(dialog).findByRole("button", { name: "Copy the guide's link" }),
  ).toHaveTextContent("Copied");
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy your ballot" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(String((writeText.mock.calls[1] as unknown[])[0])).toContain("1;alpha");
});

it("an empty ballot can't be copied, and says so", () => {
  const { dialog } = show(vi.fn(() => false), {});
  expect(within(dialog).getByRole("button", { name: "Copy your ballot" })).toBeDisabled();
  expect(within(dialog).getByText("Empty so far")).toBeInTheDocument();
});

it("a pasted ballot replaces the draft, and nothing is sent", () => {
  const { onApply } = show();
  expect(screen.getByRole("button", { name: "Use this ballot" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Paste its ballot"), {
    target: { value: "beta=gamma,alpha" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this ballot" }));
  expect(onApply).toHaveBeenCalledWith({ beta: "S", gamma: "S", alpha: "A" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("a paste that can't be read says why and changes nothing", () => {
  const { onApply } = show();
  fireEvent.change(screen.getByLabelText("Paste its ballot"), { target: { value: "nope" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this ballot" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Unknown project: nope");
  expect(onApply).not.toHaveBeenCalled();
});

it("says so when settled tiers stayed as counted", () => {
  show(vi.fn(() => true));
  fireEvent.change(screen.getByLabelText("Paste its ballot"), { target: { value: "beta" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this ballot" }));
  expect(screen.getByText("Pasted. Settled tiers stay as they were counted.")).toBeInTheDocument();
});

it("opening it doesn't put the cursor in the paste box: the dialog itself has focus", () => {
  const { dialog } = show();
  expect(document.activeElement).toBe(dialog);
  expect(screen.getByLabelText("Paste its ballot")).not.toHaveFocus();
});
