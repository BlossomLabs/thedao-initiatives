import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import VoteSettings from "./VoteSettings";

const saved: {
  show: boolean;
  floorPct: number;
  capUsd: number;
  qualifyBy: number | null;
} = { show: false, floorPct: 25, capUsd: 200_000, qualifyBy: null };
const post = vi.fn();
vi.mock("~/lib/api", async (o) => ({
  ...(await o<typeof import("~/lib/api")>()),
  api: () => Promise.resolve(saved),
}));
vi.mock("~/hooks/use-admin-api", () => ({ useAdminApi: () => post }));
beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  saved.qualifyBy = null;
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <VoteSettings />
    </QueryClientProvider>,
  );
const slider = () => screen.getByRole("slider", { name: /To qualify, as a percentage/ });
const max = () => screen.getByRole("textbox", { name: "Maximum distributed per initiative" });
const saveBtn = () => screen.getByRole("button", { name: "Save changes" });

it("the switch shows the state in words and saves at once", async () => {
  mount();
  const sw = await screen.findByRole("switch", {
    name: "Show what it takes to qualify on the site",
  });
  await waitFor(() => expect(sw).not.toHaveAttribute("data-disabled"));
  expect(screen.getByText("Hidden")).toBeInTheDocument();
  fireEvent.click(sw);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/vote-settings", {
      json: { ...saved, show: true },
    })
  );
  expect(await screen.findByText("On the site")).toBeInTheDocument();
});

it("the slider sets the share to qualify from 25%, and both numbers save together", async () => {
  mount();
  await waitFor(() => expect(max()).toHaveValue("200,000"));
  expect(slider()).toHaveValue("25");
  expect(saveBtn()).toBeDisabled();
  expect(screen.queryByRole("button", { name: /Reset to 25%/ })).toBeNull();

  for (let i = 0; i < 5; i++) fireEvent.keyDown(slider(), { key: "ArrowRight" });
  expect(slider()).toHaveValue("30");
  expect(screen.getByRole("button", { name: "Reset to 25%" })).toBeInTheDocument();

  fireEvent.change(max(), { target: { value: "-5" } });
  expect(screen.getByText("Use an amount of $0 or more.")).toBeInTheDocument();
  expect(saveBtn()).toBeDisabled();
  fireEvent.change(max(), { target: { value: "$150,000" } });
  fireEvent.click(saveBtn());
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/vote-settings", {
      json: { show: false, floorPct: 30, capUsd: 150_000, qualifyBy: null },
    })
  );
  expect(await screen.findByText("Saved.")).toBeInTheDocument();
});

const deadline = () =>
  screen.getByLabelText("Last moment to qualify for the ballot") as HTMLInputElement;

it("the last moment to qualify is set in local time, saved in unix seconds", async () => {
  mount();
  await waitFor(() => expect(max()).toHaveValue("200,000"));
  expect(deadline()).toHaveValue("");
  expect(screen.getByText("No deadline: initiatives can join the ballot until the vote ends."))
    .toBeInTheDocument();
  fireEvent.change(deadline(), { target: { value: "2026-11-23T00:00" } });
  expect(saveBtn()).toBeEnabled();
  fireEvent.click(saveBtn());
  const at = new Date(2026, 10, 23, 0, 0).getTime() / 1000;
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/vote-settings", {
      json: { show: false, floorPct: 25, capUsd: 200_000, qualifyBy: at },
    })
  );
});

it("a saved deadline shows in the field and in words, and clearing it saves none", async () => {
  saved.qualifyBy = new Date(2026, 10, 23, 14, 0).getTime() / 1000;
  mount();
  await waitFor(() => expect(deadline()).toHaveValue("2026-11-23T14:00"));
  expect(screen.getByText("No more initiatives join the ballot after Nov 23, 14:00."))
    .toBeInTheDocument();
  fireEvent.change(deadline(), { target: { value: "" } });
  fireEvent.click(saveBtn());
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/vote-settings", {
      json: { show: false, floorPct: 25, capUsd: 200_000, qualifyBy: null },
    })
  );
});
