import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import WalletMenu from "./WalletMenu";

test("a keepOpen item runs its action without closing the menu; others close it", () => {
  const onClose = vi.fn();
  const copy = vi.fn();
  const out = vi.fn();
  render(
    <WalletMenu
      open
      onClose={onClose}
      items={[
        {
          key: "addr",
          label: "0x1234…abcd",
          title: "0x1234567890abcdef1234567890abcdef1234abcd",
          lucide: "copy",
          mono: true,
          keepOpen: true,
          onClick: copy,
        },
        { key: "out", label: "Sign out", lucide: "power", danger: true, onClick: out },
      ]}
    />,
  );
  const addr = screen.getByRole("menuitem", { name: "0x1234…abcd" });
  expect(addr).toHaveAttribute("title", "0x1234567890abcdef1234567890abcdef1234abcd");
  expect(addr.querySelector("span.mono")).not.toBeNull();
  fireEvent.click(addr);
  expect(copy).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(out).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});
