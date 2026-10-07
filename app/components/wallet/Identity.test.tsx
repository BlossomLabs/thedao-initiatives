import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import Identity from "./Identity";

vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));

const HOLDER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const mark = () => screen.queryAllByRole("img", { name: "ETHSecurity Badge holder" });

function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith("/api/badges") ? { holders: [HOLDER] } : { nickname: null, name: null },
    ) as never
  );
});

it("puts the badge on a holder's avatar, asking once for every avatar on the page", async () => {
  mount(
    <>
      <Identity address={HOLDER} />
      <Identity address={OTHER} />
    </>,
  );
  await waitFor(() => expect(mark()).toHaveLength(1));
  const asked = vi.mocked(api).mock.calls.map(([p]) => p).filter((p) =>
    p.startsWith("/api/badges")
  );
  expect(asked).toEqual([`/api/badges?addresses=${HOLDER},${OTHER}`]);
});

it("takes the caller's word when it already knows, without asking", async () => {
  mount(
    <>
      <Identity address={OTHER} badge />
      <Identity address={HOLDER} badge={false} />
    </>,
  );
  expect(mark()).toHaveLength(1);
  await new Promise((r) => setTimeout(r, 10));
  expect(vi.mocked(api).mock.calls.some(([p]) => p.startsWith("/api/badges"))).toBe(false);
});
