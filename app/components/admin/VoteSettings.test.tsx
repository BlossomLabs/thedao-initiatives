import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import VoteSettings from "./VoteSettings";

const saved = { show: false, floorPct: 25, capUsd: 200_000 };
const post = vi.fn();
vi.mock("~/lib/api", async (o) => ({
  ...(await o<typeof import("~/lib/api")>()),
  api: () => Promise.resolve(saved),
}));
vi.mock("~/hooks/use-admin-api", () => ({ useAdminApi: () => post }));
beforeEach(() => post.mockReset().mockResolvedValue({}));

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
      json: { show: false, floorPct: 30, capUsd: 150_000 },
    })
  );
  expect(await screen.findByText("Saved.")).toBeInTheDocument();
});
