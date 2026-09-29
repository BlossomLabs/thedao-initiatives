import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import InitiativeForm from "./InitiativeForm";
import type { Draft } from "./types";
import { emptyCriterion, emptyDraft } from "./useDraft";
import { ApiError } from "~/lib/api";

/** A draft that passes every submit rule. */
function validDraft(): Draft {
  const d = emptyDraft();
  d.page.title = "A proper title";
  d.page.summary = "A summary long enough to satisfy the forty character minimum of the rule.";
  d.page.goal = "150,000";
  d.page.duration = "12";
  d.sections = {
    why: "why",
    in_scope: "in",
    out_scope: "out",
    existing: "none",
    who: "someone",
    hard_req: "1. open source",
  };
  d.milestones[0].name = "Only milestone";
  d.milestones[0].amount = "150,000";
  d.milestones[0].adoption = true;
  d.milestones[0].criteria = [emptyCriterion("Something a reviewer can check")];
  d.priv.funders = "Ethereum Foundation | yes";
  d.priv.contact = "me@example.org";
  return d;
}

const setup = (initial?: Draft, onSubmit = vi.fn(async () => {})) => {
  const utils = render(
    <InitiativeForm
      mode="submit"
      initial={initial}
      onSubmit={onSubmit}
      submitLabel="Submit for review"
      autosaveKey={null}
    />,
  );
  return { ...utils, onSubmit };
};

describe("InitiativeForm checks", () => {
  it("paints a discussion link past the cap as too long, live, instead of cutting it", () => {
    const d = validDraft();
    d.page.discourseUrl = "https://forum.example.org/t/" + "a".repeat(301);
    setup(d);
    expect(document.getElementById("f-discourse_url")).toHaveClass("has-error");
    expect(
      screen.getAllByText("The discussion link is too long (300 characters at most).").length,
    ).toBeGreaterThan(0);
    // one whole character of room past the cap, even an emoji
    expect(document.getElementById("f-discourse_url")).toHaveAttribute("maxlength", "302");
  });

  it("names an other link past the cap as too long, not as not-https", () => {
    const d = validDraft();
    d.page.links = "https://example.org/" + "a".repeat(301);
    setup(d);
    expect(screen.getAllByText("Link 1 is too long (300 characters at most).").length)
      .toBeGreaterThan(0);
    expect(screen.queryByText(/must be an https URL/)).toBeNull();
  });

  it("hides missing-kind errors until the first submit attempt", () => {
    setup();
    expect(document.querySelector(".has-error")).toBeNull();
    expect(screen.queryByText(/is required\. Answer the question above\./)).toBeNull();
    expect(screen.getByText(/Nothing is wrong with what is filled in so far/)).toBeInTheDocument();
    expect(document.querySelector("[data-checks]")?.textContent).toMatch(
      /0 of \d+ required answered/,
    );
  });

  it("submit paints every missing field, focuses the first one and counts them", async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    const title = document.getElementById("f-title")!;
    expect(title).toHaveClass("has-error");
    expect(document.getElementById("f-why")).toHaveClass("has-error");
    // under the field, and again as a jump link in the checks card
    expect(screen.getAllByText(/Why this matters is required\. Answer the question above\./))
      .toHaveLength(2);
    expect(document.querySelector('[data-field="why"] .fld-err')).toHaveTextContent(
      "Why this matters is required.",
    );
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getByText(/things need fixing, marked above\./)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("fixing a field clears its paint", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    const title = document.getElementById("f-title")!;
    expect(title).toHaveClass("has-error");
    fireEvent.change(title, { target: { value: "A proper title" } });
    expect(title).not.toHaveClass("has-error");
    expect(document.getElementById("f-summary")).toHaveClass("has-error");
  });

  it("a clean draft posts the payload", async () => {
    const { onSubmit } = setup(validDraft());
    expect(screen.getByText(/Nothing is wrong with what is filled in so far/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload] = onSubmit.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(payload).toMatchObject({ type: "rfp", goal: "150000", durationMonths: "12" });
    expect(document.querySelector(".has-error")).toBeNull();
  });

  it("paints the findings of a 400 on their fields and shows the alert", async () => {
    const onSubmit = vi.fn(() =>
      Promise.reject(
        new ApiError(400, "3 things need fixing.", {
          error: "3 things need fixing.",
          findings: {
            errors: [
              {
                field: "ms_0_amount",
                msg: "Milestone A: enter what this milestone pays.",
                kind: "content",
              },
              { field: "", msg: "This exact text is already submitted." },
            ],
            warnings: [{ field: "ms_0_c0", msg: "Milestone A, not checkable yet: TBD." }],
          },
        }),
      )
    );
    setup(validDraft(), onSubmit);
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() => expect(document.getElementById("f-ms_0_amount")).toHaveClass("has-error"));
    expect(screen.getByRole("alert")).toHaveTextContent("3 things need fixing.");
    expect(screen.getAllByText("Milestone A: enter what this milestone pays.").length)
      .toBeGreaterThan(0);
    expect(document.getElementById("f-ms_0_c0")).toHaveClass("has-warn");
    expect(screen.getByText("This exact text is already submitted.")).toBeInTheDocument();
    // the next change clears the server's findings
    fireEvent.change(document.getElementById("f-ms_0_amount")!, { target: { value: "150,001" } });
    await waitFor(() =>
      expect(document.getElementById("f-ms_0_amount")).not.toHaveClass("has-error")
    );
    expect(screen.queryByText("This exact text is already submitted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["title", "Ethereum Security Monitor - test"],
    ["why", "An updated reason to fund this work"],
    ["ms_0_c0", "A revised criterion a reviewer can check"],
  ])(
    "clears duplicate feedback after editing %s and submits the updated draft",
    async (field, value) => {
      const duplicate =
        'This exact text is already submitted ("Open Source Ethereum Security Monitor"). Edit it before submitting again.';
      const onSubmit = vi.fn(async () => {}).mockRejectedValueOnce(
        new ApiError(400, "Please fix the problems marked on the form.", {
          findings: { errors: [{ field: "", msg: duplicate }], warnings: [] },
        }),
      );
      setup(validDraft(), onSubmit);
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      expect(await screen.findByText(duplicate)).toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();

      fireEvent.change(document.getElementById(`f-${field}`)!, { target: { value } });
      expect(screen.queryByText(duplicate)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
      const [payload] = onSubmit.mock.calls[1] as unknown as [Record<string, unknown>];
      expect(payload).toMatchObject(
        field === "title"
          ? { title: value }
          : field === "why"
          ? { sections: { why: value } }
          : { milestones: [{ criteria: [value] }] },
      );
    },
  );

  it("ignores duplicate feedback arriving after the submitted draft was edited", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<void>((_, fail) => {
      reject = fail;
    });
    const onSubmit = vi.fn(() => pending);
    setup(validDraft(), onSubmit);
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.change(document.getElementById("f-title")!, {
      target: { value: "Ethereum Security Monitor - test" },
    });

    await act(async () => {
      reject(
        new ApiError(400, "Please fix the problems marked on the form.", {
          findings: {
            errors: [{ field: "", msg: "This exact text is already submitted." }],
            warnings: [],
          },
        }),
      );
      await pending.catch(() => {});
    });
    expect(screen.queryByText("This exact text is already submitted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.getElementById("f-title")).toHaveValue("Ethereum Security Monitor - test");
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled();
  });
});

describe("categories in the checks", () => {
  const form = (d: Draft, onSubmit = vi.fn(async () => {}), withCats = true) =>
    render(
      <InitiativeForm
        mode="submit"
        initial={d}
        onSubmit={onSubmit}
        submitLabel="Submit for review"
        autosaveKey={null}
        categories={withCats ? {} : undefined}
      />,
    );
  const total = () =>
    Number(/of (\d+) required/.exec(screen.getByText(/required answered/).textContent ?? "")?.[1]);

  it("counts categories as a required question", () => {
    const { unmount } = form(validDraft(), undefined, false);
    const without = total();
    unmount();
    form(validDraft());
    expect(total()).toBe(without + 1);
  });

  it("an empty category list blocks the submit, is listed, painted and focused", async () => {
    const onSubmit = vi.fn(async () => {});
    form(validDraft(), onSubmit);
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing blocks this submission/)).toBeNull();
    expect(screen.getAllByText("Pick at least one category.").length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(document.activeElement?.id).toBe("f-categories"));
  });

  it("says nothing blocks only when every required question is answered", async () => {
    form({ ...validDraft(), categories: ["opsec"] });
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/ }));
    expect(await screen.findByText(/Nothing blocks this submission/)).toBeInTheDocument();
  });

  it("a legacy untagged row on the edit page cannot save until one is picked", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <InitiativeForm
        mode="edit"
        initial={validDraft()}
        onSubmit={onSubmit}
        submitLabel="Save"
        categories={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(document.activeElement?.id).toBe("f-categories"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
