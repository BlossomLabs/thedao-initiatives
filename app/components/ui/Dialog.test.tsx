import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog } from "./Dialog";

/** Mirrors EmailSignInDialog: an inline onOpenChange plus a controlled input. */
function Harness() {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)} title="Sign in with email">
      <input aria-label="Email" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button">Send code</button>
    </Dialog>
  );
}

describe("Dialog focus", () => {
  it("focuses the first field, not the close button, and keeps it while typing", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    expect(input).toHaveFocus();
    act(() => {
      fireEvent.change(input, { target: { value: "g" } });
    });
    expect(input.value).toBe("g");
    expect(input).toHaveFocus();
    expect(screen.getByLabelText("Close")).not.toHaveFocus();
  });

  it("falls back to a button when there is no field, and Escape uses the latest handler", () => {
    function NoField() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={(o) => setOpen(o)} title="Plain">
          <button type="button">OK</button>
        </Dialog>
      );
    }
    render(<NoField />);
    expect(screen.getByText("OK")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
