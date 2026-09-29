import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import CategoriesPicker from "./CategoriesPicker";

function Harness(
  { start = [] as string[], suggestion = null as string[] | null, onChange = vi.fn() } = {},
) {
  const [value, setValue] = useState(start);
  return (
    <CategoriesPicker
      id="f-categories"
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
      suggestion={suggestion}
    />
  );
}

const input = () => screen.getByRole("combobox", { name: /Categories/ });
const open = () => {
  input().focus();
  fireEvent.keyDown(input(), { key: "ArrowDown" });
};
const pick = (query: string) => {
  fireEvent.change(input(), { target: { value: query } });
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  fireEvent.keyDown(input(), { key: "Enter" });
};

it("picks several with the keyboard, keeping the list open, in the order picked", async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  open();
  pick("ops");
  expect(onChange).toHaveBeenLastCalledWith(["opsec"]);
  pick("defi");
  expect(onChange).toHaveBeenLastCalledWith(["opsec", "defi"]);
  expect(await screen.findByRole("listbox")).toBeInTheDocument();
});

it("shows removable tokens, and removing one keeps the others' order", () => {
  const onChange = vi.fn();
  render(<Harness start={["opsec", "defi", "compilers"]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove DeFi Safety" }));
  expect(onChange).toHaveBeenLastCalledWith(["opsec", "compilers"]);
});

it("at three, disables the other options, keeps the picked ones, and says why", async () => {
  const onChange = vi.fn();
  render(<Harness start={["opsec", "defi", "compilers"]} onChange={onChange} />);
  expect(screen.getByText(/You can pick up to 3/)).toBeInTheDocument();
  open();
  const list = await screen.findByRole("listbox");
  const fv = within(list).getByRole("option", { name: /Formal Verification/ });
  expect(fv).toHaveAttribute("aria-disabled", "true");
  expect(within(list).getByRole("option", { name: /OpSec/ })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  fireEvent.click(fv);
  expect(onChange).not.toHaveBeenCalled();
});

it("a Primary category select appears with two or more and reorders them", async () => {
  const onChange = vi.fn();
  render(<Harness start={["opsec", "defi"]} onChange={onChange} />);
  const primary = screen.getByRole("combobox", { name: "Primary category" });
  expect(primary).toHaveTextContent("OpSec");
  primary.focus();
  fireEvent.keyDown(primary, { key: "ArrowDown" });
  // Keyboard, as Base UI ignores a click that lands the instant the list opens.
  const opt = await screen.findByRole("option", { name: "DeFi Safety" });
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
  await waitFor(() => expect(opt).toHaveAttribute("data-highlighted"));
  fireEvent.keyDown(opt, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith(["defi", "opsec"]);
});

it("no Primary category select with one", () => {
  render(<Harness start={["opsec"]} />);
  expect(screen.queryByRole("combobox", { name: "Primary category" })).toBeNull();
});

it("offers a suggestion only on an empty field, applied only on Use suggestions", () => {
  const onChange = vi.fn();
  const { unmount } = render(<Harness suggestion={["defi", "opsec"]} onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use suggestions" }));
  expect(onChange).toHaveBeenLastCalledWith(["defi", "opsec"]);
  unmount();
  render(<Harness start={["compilers"]} suggestion={["defi"]} />);
  expect(screen.queryByRole("button", { name: "Use suggestions" })).toBeNull();
});
