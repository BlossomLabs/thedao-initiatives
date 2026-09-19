import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./Select";

const MODES = [
  { value: "merge", label: "Merge (keep existing rows)" },
  { value: "replace", label: "Replace (overwrite existing rows)" },
];

function Modes(props: { value?: string; onValueChange?: (v: string | null) => void }) {
  return (
    <form aria-label="restore">
      <Select name="mode" items={MODES} defaultValue="merge" {...props}>
        <SelectTrigger aria-label="Mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </form>
  );
}

test("the trigger shows the chosen item's label, and the value posts with the form under its name", () => {
  render(<Modes />);
  expect(screen.getByRole("combobox", { name: "Mode" })).toHaveTextContent(
    "Merge (keep existing rows)",
  );
  const form = screen.getByRole("form", { name: "restore" }) as HTMLFormElement;
  expect(new FormData(form).get("mode")).toBe("merge");
});

test("picking an item reports its value", async () => {
  const onValueChange = vi.fn();
  render(<Modes onValueChange={onValueChange} />);
  // Keyboard, as Base UI ignores a click that lands the instant the list opens.
  const trigger = screen.getByRole("combobox", { name: "Mode" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name: "Replace (overwrite existing rows)" });
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
  await waitFor(() => expect(option).toHaveAttribute("data-highlighted"));
  fireEvent.keyDown(option, { key: "Enter" });
  expect(onValueChange).toHaveBeenCalledWith("replace", expect.anything());
});
