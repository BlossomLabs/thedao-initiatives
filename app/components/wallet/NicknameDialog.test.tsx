import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  NICKNAME_MAX,
  PRIVATE_BADGE_AVATAR,
  PRIVATE_BADGE_AVATAR_RULE,
  PRIVATE_BADGE_PFP,
} from "@shared/profile";
import { api } from "~/lib/api";
import NicknameDialog from "./NicknameDialog";

const identity = vi.hoisted(() => ({
  nameFromEns: false,
  avatarFromEns: false,
  avatarFromBadge: false,
  avatarLocked: false,
  nickname: "",
  pfp: "",
  avatar: "",
  ens: "",
  hasName: false,
  hasAvatar: false,
}));

vi.mock("~/lib/api", () => ({ api: vi.fn(), errorMessage: (e: unknown) => String(e) }));
vi.mock("~/context/session", () => ({
  useSession: () => ({
    address: "0x0000000000000000000000000000000000000001",
    requireSession: vi.fn().mockResolvedValue(undefined),
    refreshMe: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("~/hooks/use-identity", () => ({
  useIdentity: () => identity,
}));

beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({});
  Object.assign(identity, {
    nameFromEns: false,
    avatarFromEns: false,
    avatarFromBadge: false,
    avatarLocked: false,
    nickname: "",
    pfp: "",
    avatar: "",
    ens: "",
    hasName: false,
    hasAvatar: false,
  });
});
afterEach(cleanup);

function show() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NicknameDialog open onOpenChange={() => {}} firstTime uploadsEnabled />
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

it("locks the private badge avatar while still allowing a display name change", async () => {
  Object.assign(identity, {
    avatarFromBadge: true,
    avatarLocked: true,
    pfp: PRIVATE_BADGE_PFP,
    avatar: PRIVATE_BADGE_AVATAR,
    hasAvatar: true,
  });
  show();
  expect(screen.getByText(PRIVATE_BADGE_AVATAR_RULE)).toBeInTheDocument();
  expect(screen.queryByAltText("Preset 1")).toBeNull();
  expect(screen.queryByRole("button", { name: "Upload a picture" })).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(document.querySelector("img")).toHaveAttribute("src", PRIVATE_BADGE_AVATAR);
  fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Voter" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledExactlyOnceWith("/api/nickname", {
      json: { nickname: "Voter" },
    })
  );
});

it("offers only Close when the private badge avatar and ENS name are both locked", () => {
  Object.assign(identity, {
    nameFromEns: true,
    avatarFromBadge: true,
    avatarLocked: true,
    ens: "voter.eth",
    pfp: PRIVATE_BADGE_PFP,
    avatar: PRIVATE_BADGE_AVATAR,
  });
  show();
  expect(screen.getByText(PRIVATE_BADGE_AVATAR_RULE)).toBeInTheDocument();
  expect(screen.getByText("Close", { selector: "button" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.queryByText(/Both come from your ENS profile/)).toBeNull();
});

it("keeps preset selection and upload available to other wallets", async () => {
  show();
  expect(screen.getByRole("button", { name: "Upload a picture" })).toBeInTheDocument();
  fireEvent.click(screen.getByAltText("Preset 4"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledExactlyOnceWith("/api/pfp", {
      json: { pfp: "preset:3" },
    })
  );
});
