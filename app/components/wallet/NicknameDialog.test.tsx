import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NICKNAME_MAX } from "@shared/profile";
import { api } from "~/lib/api";
import NicknameDialog from "./NicknameDialog";

vi.mock("~/lib/api", () => ({ api: vi.fn(), errorMessage: (e: unknown) => String(e) }));
vi.mock("~/context/session", () => ({
  useSession: () => ({
    address: "0x0000000000000000000000000000000000000001",
    requireSession: vi.fn().mockResolvedValue(undefined),
    refreshMe: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("~/hooks/use-identity", () => ({
  useIdentity: () => ({
    nameFromEns: false,
    avatarFromEns: false,
    nickname: "",
    pfp: "",
    avatar: "",
    ens: "",
    hasName: false,
    hasAvatar: false,
  }),
}));

afterEach(cleanup);

function show() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NicknameDialog open onOpenChange={() => {}} firstTime />
    </QueryClientProvider>,
  );
}

it("refuses a display name past the cap before any request, never cutting it", () => {
  show();
  const input = screen.getByPlaceholderText("Your name");
  // jsdom does not enforce maxLength: this is the paste that lands one past the cap
  fireEvent.change(input, { target: { value: "N".repeat(NICKNAME_MAX + 1) } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByText("The name is too long (40 characters at most).")).toBeInTheDocument();
  expect(input).toHaveAttribute("maxlength", String(NICKNAME_MAX + 2));
});
