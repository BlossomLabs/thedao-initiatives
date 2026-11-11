import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import VoteRelayer from "./VoteRelayer";

vi.mock("~/lib/api", async (o) => ({
  ...(await o<typeof import("~/lib/api")>()),
  api: vi.fn(),
}));

const mount = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <VoteRelayer />
    </QueryClientProvider>,
  );

it("shows the relayer's address, its balance and the chain", async () => {
  vi.mocked(api).mockResolvedValue({
    address: "0x9000000000000000000000000000000000000009",
    balanceWei: "42000000000000000",
    chainId: 1,
  });
  mount();
  expect(await screen.findByText("Vote relayer")).toBeInTheDocument();
  expect(screen.getByText("0.0420 ETH on Ethereum")).toBeInTheDocument();
  expect(screen.getByText("0x9000000000000000000000000000000000000009")).toBeInTheDocument();
  expect(vi.mocked(api)).toHaveBeenCalledWith("/api/vote/relayer", expect.anything());
});

it("says when no relayer key is set", async () => {
  vi.mocked(api).mockResolvedValue({ address: null, balanceWei: null, chainId: 11155111 });
  mount();
  expect(await screen.findByText(/No relayer key is set/)).toBeInTheDocument();
});
