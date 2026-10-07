import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ConfirmPrivateFields from "./ConfirmPrivateFields";

const signIn = vi.hoisted(() => vi.fn());
vi.mock("~/context/session", () => ({ useSession: () => ({ signIn }) }));
beforeEach(() => {
  signIn.mockReset();
});

it("requests fresh proof only on a click, then reloads the private fields", async () => {
  signIn.mockResolvedValue({});
  const reload = vi.fn().mockResolvedValue({});
  render(<ConfirmPrivateFields onConfirm={reload} />);
  expect(signIn).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm wallet to view contacts" }));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(signIn).toHaveBeenCalledTimes(1);
});

it("keeps private fields hidden when the signature is refused", async () => {
  signIn.mockRejectedValue(new Error("User rejected the request."));
  const reload = vi.fn();
  render(<ConfirmPrivateFields onConfirm={reload} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm wallet to view contacts" }));
  await screen.findByRole("alert");
  expect(reload).not.toHaveBeenCalled();
});
