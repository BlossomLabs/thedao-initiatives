import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SECTIONS } from "@shared/draft/mod";
import InitiativeForm from "./InitiativeForm";
import { PREVIEW_BANNER } from "./PreviewPane";
import type { Draft } from "./types";
import { emptyCriterion, emptyDraft } from "./useDraft";

/** A grant draft that passes every submit rule. */
function validDraft(): Draft {
  const d = emptyDraft();
  d.type = "grant";
  d.page.title = "A proper title";
  d.page.summary = "A summary long enough to satisfy the forty character minimum of the rule.";
  d.page.goal = "150,000";
  d.page.duration = "12";
  d.page.recipientTeam = "Vyper core team";
  d.page.recipientUrl = "https://vyperlang.org/";
  d.page.discourseUrl = "https://forum.example.org/t/1";
  d.page.links = "https://www.example.org/spec\nhttps://github.com/example/repo";
  d.categories = ["opsec"];
  d.sections = Object.fromEntries(SECTIONS.grant.map((k) => [k, "answered"]));
  d.milestones[0].name = "Only milestone";
  d.milestones[0].amount = "150,000";
  d.milestones[0].adoption = true;
  d.milestones[0].criteria = [emptyCriterion("Something a reviewer can check")];
  d.priv.funders = "Ethereum Foundation | yes";
  d.priv.contact = "me@example.org";
  return d;
}

const setup = (initial: Draft | undefined, onSubmit = vi.fn(async () => {})) => {
  render(
    <InitiativeForm
      mode="submit"
      initial={initial}
      onSubmit={onSubmit}
      submitLabel="Submit for review"
      autosaveKey={null}
      categories={{}}
    />,
  );
  return onSubmit;
};

const preview = () => fireEvent.click(screen.getByRole("button", { name: "Preview" }));

describe("InitiativeForm preview", () => {
  it("opens from the Preview button and goes back to editing", () => {
    setup(emptyDraft());
    expect(screen.queryByRole("button", { name: /See it as a page/ })).toBeNull();
    preview();
    expect(screen.getByText(PREVIEW_BANNER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to editing/ }));
    expect(screen.queryByText(PREVIEW_BANNER)).toBeNull();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
  });

  it("shows the header and the side cards of the real page", () => {
    const d = validDraft();
    d.topup = true;
    setup(d);
    preview();
    // the page has no "to <team>" or top-up chip: both are key facts
    expect(screen.queryByText(/^to\s/)).toBeNull();
    expect(screen.queryByText("top-up, work under way")).toBeNull();
    expect(screen.getByText("pending review")).toBeInTheDocument();
    expect(document.querySelector("[data-categories] .cat-tag")).not.toBeNull();
    const facts = screen.getByText("Key facts").closest(".panel") as HTMLElement;
    expect(within(facts).getByRole("link", { name: "Vyper core team" })).toBeInTheDocument();
    expect(within(facts).getByRole("link", { name: "example.org" })).toHaveAttribute(
      "href",
      "https://www.example.org/spec",
    );
    expect(within(facts).getByRole("link", { name: "github.com" })).toBeInTheDocument();
    // no Links section in the body any more
    expect(screen.queryByRole("heading", { name: "Links" })).toBeNull();
    // the side cards of the page, in its order
    const cards = [...(facts.parentElement as HTMLElement).querySelectorAll(".panel > .k")]
      .map((k) => k.textContent);
    expect(cards).toEqual([
      "Donate to this initiative",
      "Key facts",
      "Join the discussion",
      "Back this initiative",
      "What happens next",
    ]);
  });

  it("submits from the preview when nothing blocks", async () => {
    const d = validDraft();
    const onSubmit = setup(d);
    preview();
    const button = screen.getByRole("button", { name: /Submit for review/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("disables submit while something blocks, and shows what on request", async () => {
    const onSubmit = setup(emptyDraft());
    preview();
    expect(screen.getByRole("button", { name: /Submit for review/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Show (it|them)/ }));
    expect(screen.queryByText(PREVIEW_BANNER)).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector(".has-error")).not.toBeNull());
  });

  it("returns to editing with the alert when the server refuses", async () => {
    const d = validDraft();
    setup(
      d,
      vi.fn(() => Promise.reject(new Error("The API is down"))),
    );
    preview();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The API is down");
    expect(screen.queryByText(PREVIEW_BANNER)).toBeNull();
  });
});
