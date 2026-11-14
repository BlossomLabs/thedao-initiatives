import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parseBallotText } from "../../../shared/vote/ballot-text";
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
    "A prompt to start",
  );
  expect(within(dialog).getByText("1 initiative in 1 tier: copy separately")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: "open guide" })).toHaveAttribute(
    "href",
    "/vote/llms.txt",
  );
  expect(within(dialog).getByLabelText("Paste its ballot")).toBeInTheDocument();
});

it("copies a prompt with the guide and current ballot as YAML", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const tiers = { alpha: "S", beta: "S", gamma: "B" } as const;
  const { dialog } = show(vi.fn(() => false), tiers);
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy prompt" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const prompt = String((writeText.mock.calls[0] as unknown[])[0]);
  expect(prompt).toContain(`${location.origin}/vote/llms.txt`);
  expect(prompt).toContain("Start from my ballot below.");
  expect(prompt).toContain("once I approve.");
  expect(await parseBallotText(prompt.split("\n\n").at(-1)!, slugs)).toEqual({ tiers });
  expect(prompt).toContain(
    "```yaml\nS-Tier:\n  - alpha\n  - beta\nA-Tier: []\nB-Tier:\n  - gamma\n```",
  );
  expect(
    within(dialog).getByRole("button", { name: "Copy prompt" }),
  ).toHaveTextContent("Copied");
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy your ballot" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(String((writeText.mock.calls[1] as unknown[])[0])).toBe(
    "S-Tier:\n  - alpha\n  - beta\nA-Tier: []\nB-Tier:\n  - gamma",
  );
});

it("an empty ballot still gets a starter prompt, while copying it separately stays disabled", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const { dialog } = show(vi.fn(() => false), {});
  expect(within(dialog).getByRole("button", { name: "Copy your ballot" })).toBeDisabled();
  expect(within(dialog).getByText("Empty so far")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy prompt" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain(
    "(No initiatives ranked yet.)",
  );
});

it("a pasted ballot replaces the draft, and nothing is sent", async () => {
  const { onApply } = show();
  expect(screen.getByRole("button", { name: "Use this ballot" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Paste its ballot"), {
    target: { value: "S-Tier: [beta, gamma]\nA-Tier: [alpha]" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this ballot" }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith({ beta: "S", gamma: "S", alpha: "A" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("a paste that can't be read says why and changes nothing", async () => {
  const { onApply } = show();
  fireEvent.change(screen.getByLabelText("Paste its ballot"), {
    target: { value: "S-Tier: [nope]" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this ballot" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unknown project: nope");
  expect(onApply).not.toHaveBeenCalled();
});

it("says so when settled tiers stayed as counted", async () => {
  show(vi.fn(() => true));
  fireEvent.change(screen.getByLabelText("Paste its ballot"), {
    target: { value: "S-Tier: [beta]" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this ballot" }));
  expect(await screen.findByText("Pasted. Settled tiers stay as they were counted."))
    .toBeInTheDocument();
});

it("opening it doesn't put the cursor in the paste box: the dialog itself has focus", () => {
  const { dialog } = show();
  expect(document.activeElement).toBe(dialog);
  expect(screen.getByLabelText("Paste its ballot")).not.toHaveFocus();
});
