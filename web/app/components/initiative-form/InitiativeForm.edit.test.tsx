import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { structuredRow } from "../../../test/fixtures";
import InitiativeForm, { LOCK_NOTE } from "./InitiativeForm";
import type { InitiativeFormProps } from "./InitiativeForm";
import { fromInitiative } from "./useDraft";

const setup = (props: Partial<InitiativeFormProps> = {}) => {
  const onSubmit = props.onSubmit ?? vi.fn(async () => {});
  const utils = render(
    <InitiativeForm
      mode="proposer"
      initial={fromInitiative(structuredRow())}
      onSubmit={onSubmit}
      submitLabel="Save as a new revision"
      showBackers={false}
      showRules={false}
      autosaveKey={null}
      {...props}
    />,
  );
  return { ...utils, onSubmit };
};

const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

describe("InitiativeForm in edit mode", () => {
  it("renders the row's sections, milestones, links and facts from fromInitiative", () => {
    setup({ showPrivate: true, showTypePicker: true });
    expect(value("f-title")).toBe("Audit tooling for rollups");
    expect(value("f-why")).toBe("why");
    expect(value("f-commitments")).toBe("commit");
    expect(value("f-ms_0_name")).toBe("Only milestone");
    expect(value("f-ms_0_amount")).toBe("150,000");
    expect(document.getElementById("f-ms_0_adoption")).toBeChecked();
    expect(value("f-ms_0_c0")).toBe("Something a reviewer can check");
    expect(value("f-links")).toBe("https://github.com/example/repo");
    expect(value("f-goal")).toBe("150,000");
    expect(value("f-duration_months")).toBe("12");
    expect(value("f-recipient_team")).toBe("Rollup Labs");
    expect(value("f-funders")).toBe("Ethereum Foundation | yes");
    expect(value("f-contact")).toBe("me@example.org");
    expect(screen.getByRole("radio", { name: /Grant/ })).toBeChecked();
    // edit scope: the row passes every rule as it is
    expect(screen.getByText(/Nothing is wrong with what is filled in so far/)).toBeInTheDocument();
    expect(screen.queryByText(LOCK_NOTE)).toBeNull();
  });

  it("locked: the money facts are read-only, the lock note shows, the private fields are gone", () => {
    setup({ locked: true, showPrivate: false, showTypePicker: false });
    expect(screen.getByText(LOCK_NOTE)).toBeInTheDocument();
    expect(document.getElementById("f-goal")).toBeDisabled();
    expect(document.getElementById("f-duration_months")).toBeDisabled();
    expect(document.getElementById("f-recipient_team")).toBeDisabled();
    expect(document.getElementById("f-discourse_url")).toBeDisabled();
    expect(screen.queryByRole("radio", { name: /Grant/ })).toBeNull();
    expect(document.getElementById("f-funders")).toBeNull();
    expect(document.getElementById("f-contact")).toBeNull();
    // the text stays editable
    expect(document.getElementById("f-title")).not.toBeDisabled();
    expect(document.getElementById("f-why")).not.toBeDisabled();
    expect(document.getElementById("f-ms_0_name")).not.toBeDisabled();
  });

  it("a locked type picker keeps the radios but disables them", () => {
    setup({ locked: true, showTypePicker: true });
    expect(screen.getByRole("radio", { name: /Grant/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /RFP/ })).toBeDisabled();
  });

  it("saves the structured payload of the edited row", async () => {
    const { onSubmit } = setup();
    fireEvent.change(document.getElementById("f-ms_0_c0")!, {
      target: { value: "A sharper criterion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as a new revision" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [payload] = (onSubmit as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(payload).toMatchObject({
      type: "grant",
      title: "Audit tooling for rollups",
      goal: "150000",
      links: ["https://github.com/example/repo"],
    });
    expect((payload.milestones as { criteria: string[] }[])[0].criteria).toEqual([
      "A sharper criterion",
    ]);
    expect(Object.keys(payload.sections as object)).toEqual([
      "why",
      "team",
      "why_grant",
      "in_scope",
      "out_scope",
      "commitments",
    ]);
  });

  it("admin mode: enforce off saves past client errors and paints the returned findings", async () => {
    const onSubmit = vi.fn(() =>
      Promise.resolve({
        errors: [
          {
            field: "why",
            msg: "Why this matters is required. Answer the question above.",
            kind: "missing" as const,
          },
        ],
        warnings: [{ field: "ms_0_c0", msg: "Milestone A, not checkable yet: vague." }],
      })
    );
    setup({ mode: "admin", enforce: false, layout: "inline", onSubmit });
    fireEvent.change(document.getElementById("f-why")!, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as a new revision" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.getElementById("f-why")).toHaveClass("has-error"));
    expect(document.getElementById("f-ms_0_c0")).toHaveClass("has-warn");
    // saved, so no alert and no "needs fixing" line
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/needs fixing, marked above/)).toBeNull();
    // inline layout: the checks card sits inside the column, no sidebar
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector("[data-checks]")).not.toBeNull();
  });

  it("proposer mode: client errors still block the save", async () => {
    const { onSubmit } = setup();
    fireEvent.change(document.getElementById("f-why")!, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as a new revision" }));
    await waitFor(() => expect(document.getElementById("f-why")).toHaveClass("has-error"));
    expect(screen.getByText(/needs fixing, marked above/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
