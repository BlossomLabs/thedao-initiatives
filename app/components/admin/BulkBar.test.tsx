// deno-lint-ignore-file require-await
// act() takes async callbacks so the promise-returning handlers flush before the asserts.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSelection } from "~/hooks/use-selection";
import BulkBar, { HeadCheck, RowCheck } from "./BulkBar";

function Harness(
  { onAct }: {
    onAct: (
      key: string,
      ids: string[],
    ) => Promise<{ done: number; failed: { id: string; error: string }[] }>;
  },
) {
  const ids = ["a", "b", "c"];
  const sel = useSelection(ids);
  return (
    <div>
      <BulkBar
        selection={sel}
        noun="entry"
        actions={[
          { key: "publish", label: "Publish" },
          { key: "discard", label: "Discard", confirm: "Discard {n} {noun}?" },
        ]}
        onAct={onAct}
      />
      <HeadCheck selection={sel} label="all" />
      {ids.map((id) => <RowCheck key={id} selection={sel} id={id} label={id} />)}
    </div>
  );
}

describe("BulkBar", () => {
  it("appears with a count, runs a plain action, then clears and reports", async () => {
    const onAct = vi.fn(async () => ({ done: 2, failed: [] }));
    render(<Harness onAct={onAct} />);
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.click(screen.getByLabelText("a"));
    fireEvent.click(screen.getByLabelText("b"));
    expect(screen.getByText("2 entries selected")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    });
    expect(onAct).toHaveBeenCalledWith("publish", ["a", "b"]);
    expect(screen.getByText("Publish: 2 entries done.")).toBeInTheDocument();
    expect((screen.getByLabelText("a") as HTMLInputElement).checked).toBe(false);
  });

  it("confirms destructive actions inline and can cancel", async () => {
    const onAct = vi.fn(async () => ({ done: 1, failed: [{ id: "c", error: "not found" }] }));
    render(<Harness onAct={onAct} />);
    fireEvent.click(screen.getByLabelText("all"));
    expect(screen.getByText("3 entries selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByText("Discard 3 entries?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, discard" }));
    });
    expect(onAct).toHaveBeenCalledWith("discard", ["a", "b", "c"]);
    expect(screen.getByText(/1 of 3 entries done; 1 failed \(not found\)/)).toBeInTheDocument();
  });
});
