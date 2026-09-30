import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import CommentsSection from "./CommentsSection";

vi.mock("~/context/wallet", () => ({ useWallet: () => ({ isConnected: false }) }));
vi.mock("~/context/session", () => ({
  useSession: () => ({ session: null, requireSession: vi.fn() }),
  sessionKey: () => null,
}));
vi.mock("~/lib/api", () => ({ api: vi.fn() }));
vi.mock("./EntryCard", () => ({
  default: (
    { c, canVote }: {
      c: { id: string; roles: string[]; replies?: { id: string; roles: string[] }[] };
      canVote: boolean;
    },
  ) => (
    <div>
      {[c, ...(c.replies ?? [])].map((x) => `${x.id}:${x.roles.join("+")}`).join(" ")}
      {canVote ? " votes" : ""}
    </div>
  ),
}));
vi.mock("./Composer", () => ({
  default: (
    { onPost }: { onPost: (...args: [string, string, string, boolean]) => Promise<unknown> },
  ) => (
    <button type="button" onClick={() => void onPost("My comment", "Alice", "", false)}>
      Post comment
    </button>
  ),
}));

it("posts the displayed proposal ID and separates comment caches for reused URLs", async () => {
  localStorage.clear();
  vi.mocked(api).mockImplementation((_path, opts) =>
    Promise.resolve(
      opts?.json
        ? { status: "held", claimToken: "" }
        : { entries: [], viewerCanVote: false, viewerRoles: [] },
    )
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const show = (id: string) => (
    <QueryClientProvider client={qc}>
      <CommentsSection initiativeId={id} slug="shared-url" open />
    </QueryClientProvider>
  );
  const { rerender, unmount } = render(show("first-id"));
  fireEvent.click(screen.getByText("Post comment"));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/initiatives/shared-url/comments",
      expect.objectContaining({ json: expect.objectContaining({ initiativeId: "first-id" }) }),
    )
  );
  rerender(show("replacement-id"));
  fireEvent.click(screen.getByText("Post comment"));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/initiatives/shared-url/comments",
      expect.objectContaining({
        json: expect.objectContaining({ initiativeId: "replacement-id" }),
      }),
    )
  );
  expect(qc.getQueryCache().findAll({ queryKey: ["comments", "shared-url"] })).toHaveLength(2);
  unmount();
  qc.clear();
});

it("adds the Expert tag and the badge's vote from a request of their own, after the list", async () => {
  localStorage.clear();
  const holder = "0x3333333333333333333333333333333333333333";
  const entry = (id: string, address: string, roles: string[], replies: unknown[] = []) => ({
    id,
    address,
    roles,
    replies,
    votes: 0,
    createdAt: 1,
  });
  let answerExperts = (_v: unknown) => {};
  vi.mocked(api).mockImplementation((path) =>
    path.endsWith("/comments/experts")
      ? new Promise((resolve) => (answerExperts = resolve))
      : Promise.resolve({
        entries: [
          entry("a", holder.toUpperCase().replace("0X", "0x"), ["DONOR"], [
            entry("r", holder, []),
          ]),
          entry("b", "0x4444444444444444444444444444444444444444", ["CURATOR"]),
          entry("c", "", []),
        ],
        viewerCanVote: false,
        viewerRoles: [],
      })
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={qc}>
      <CommentsSection initiativeId="id" slug="s" open={false} />
    </QueryClientProvider>,
  );
  // The comments are on screen while the chain is still being asked.
  expect(await screen.findByText("a:DONOR r:")).toBeTruthy();
  expect(api).toHaveBeenCalledWith("/api/initiatives/s/comments/experts", expect.anything());
  answerExperts({ experts: [holder], viewerCanVote: true });
  expect(await screen.findByText("a:DONOR+EXPERT r:EXPERT votes")).toBeTruthy();
  expect(screen.getByText("b:CURATOR votes")).toBeTruthy();
  unmount();
  qc.clear();
});
