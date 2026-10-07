import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { MineItem } from "~/lib/api-types";
import { api } from "~/lib/api";
import Mine from "./mine";

vi.mock("~/context/session", () => ({
  useSession: () => ({ session: { address: "0x1111", isAdmin: false } }),
  sessionKey: () => "me",
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));
vi.mock("~/components/wallet/ConnectInline", () => ({ default: () => null }));

const item = (over: Partial<MineItem>): MineItem => ({
  slug: "one",
  title: "One",
  type: "rfp",
  status: "approved",
  goalUsd: 1000,
  createdAt: 1,
  editInReview: false,
  editRejected: null,
  ...over,
});

it("marks an edit in review, and shows the team's note when an edit was turned down", async () => {
  vi.mocked(api).mockResolvedValue({
    initiatives: [
      item({ slug: "waiting", title: "Waiting", editInReview: true }),
      item({
        slug: "refused",
        title: "Refused",
        editRejected: { n: 3, note: "Please keep the scope.", at: 2 },
      }),
      item({ slug: "quiet", title: "Quiet" }),
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Mine />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const row = async (title: string) => (await screen.findByText(title)).closest("li")!;
  expect(await row("Waiting")).toHaveTextContent("edit in review");
  expect(await row("Refused")).toHaveTextContent("edit not accepted");
  expect(await row("Refused")).toHaveTextContent("Please keep the scope.");
  expect(await row("Quiet")).not.toHaveTextContent(/edit/);
});
