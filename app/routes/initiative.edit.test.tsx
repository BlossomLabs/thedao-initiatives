import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { structuredRow } from "../../test/fixtures";
import type { InitiativePage } from "~/lib/api-types";
import type { InitiativeFormProps } from "~/components/initiative-form/InitiativeForm";
import { toPayload } from "~/components/initiative-form/useDraft";
import { useInitiative } from "~/hooks/use-initiative";
import { api } from "~/lib/api";
import EditInitiative from "./initiative.edit";

vi.mock("~/hooks/use-initiative", () => ({
  useInitiative: vi.fn(),
  initiativeKey: (slug: string) => ["initiative", slug],
}));
vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: { isAdmin: true, address: "0x1111111111111111111111111111111111111111" },
    requireSession: () => Promise.resolve({}),
  }),
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));
vi.mock("~/components/wallet/Identity", () => ({ default: () => null }));
vi.mock("~/components/initiative-form/InitiativeForm", () => ({
  default: function TestForm({ initial, onSubmit }: InitiativeFormProps) {
    const [title, setTitle] = useState(initial!.page.title);
    return (
      <>
        <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button
          type="button"
          onClick={() =>
            void onSubmit(
              toPayload({
                ...initial!,
                page: { ...initial!.page, title, duration: "7" },
              }),
              initial!,
            )}
        >
          Save
        </button>
      </>
    );
  },
}));

beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({});
});

it("resets the draft for a replacement and binds both edit requests to its ID", async () => {
  const original = {
    ...structuredRow(),
    id: "original-id",
    slug: "same-url",
    status: "pending" as const,
  };
  const replacement = { ...original, id: "replacement-id", title: "The replacement title" };
  const feed = (row: typeof original) =>
    vi.mocked(useInitiative).mockReturnValue({
      data: { initiative: row } as InitiativePage,
      isLoading: false,
      isPlaceholderData: false,
      error: null,
    } as ReturnType<typeof useInitiative>);
  feed(original);
  const qc = new QueryClient();
  const tree = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/initiative/same-url/edit"]}>
        <Routes>
          <Route path="/initiative/:slug/edit" element={<EditInitiative />} />
          <Route path="/initiative/:slug" element={<div>Saved</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender, unmount } = render(tree());
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "An old unsaved edit" } });
  feed(replacement);
  rerender(tree());
  expect(screen.getByLabelText("Title")).toHaveValue(replacement.title);
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "An updated replacement title" },
  });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(api).toHaveBeenCalledWith("/api/initiatives/same-url", {
    method: "PATCH",
    json: { durationMonths: "7", initiativeId: "replacement-id" },
  });
  expect(api).toHaveBeenCalledWith("/api/initiatives/same-url/revisions", {
    json: expect.objectContaining({
      initiativeId: "replacement-id",
      title: "An updated replacement title",
    }),
  });
  unmount();
  qc.clear();
});
