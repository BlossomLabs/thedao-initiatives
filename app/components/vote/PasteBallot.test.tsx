import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PasteBallot from "./PasteBallot";

afterEach(cleanup);
const slugs = ["alpha", "beta", "gamma"];
const show = (onApply = vi.fn(() => false)) => {
  render(
    <PasteBallot
      slugs={slugs}
      titles={(s) => s.toUpperCase()}
      askUsd={() => 1_000_000n}
      tiers={{ alpha: "S" }}
      onApply={onApply}
    />,
  );
  return onApply;
};

it("a pasted ballot replaces the draft, and nothing is sent", () => {
  const onApply = show();
  fireEvent.click(screen.getByRole("button", { name: "Paste a ballot" }));
  fireEvent.change(screen.getByLabelText("Ballot to paste"), {
    target: { value: "beta=gamma,alpha" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onApply).toHaveBeenCalledWith({ beta: "S", gamma: "S", alpha: "A" });
  expect(screen.queryByLabelText("Ballot to paste")).toBeNull();
});

it("a paste that can't be read says why and changes nothing", () => {
  const onApply = show();
  fireEvent.click(screen.getByRole("button", { name: "Paste a ballot" }));
  fireEvent.change(screen.getByLabelText("Ballot to paste"), { target: { value: "nope" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Unknown project: nope");
  expect(onApply).not.toHaveBeenCalled();
});

it("says so when settled tiers stayed as counted", () => {
  show(vi.fn(() => true));
  fireEvent.click(screen.getByRole("button", { name: "Paste a ballot" }));
  fireEvent.change(screen.getByLabelText("Ballot to paste"), { target: { value: "beta" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByText("Settled tiers stay as they were counted.")).toBeInTheDocument();
});

it("copies the ballot as a .pb and links the LLM guide", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Copy my ballot" }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain("1;alpha");
  expect(await screen.findByText("Copied.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /build your ballot with an llm/i }))
    .toHaveAttribute("href", "/vote/llms.txt");
});
