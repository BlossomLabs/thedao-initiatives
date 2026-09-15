import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "~/lib/api";
import CommentsSection from "./CommentsSection";

vi.mock("wagmi", () => ({ useAccount: () => ({ isConnected: false }) }));
vi.mock("~/context/session", () => ({
  useSession: () => ({ session: null, requireSession: vi.fn() }),
}));
vi.mock("~/lib/api", () => ({ api: vi.fn() }));
vi.mock("./EntryCard", () => ({ default: () => null }));
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
