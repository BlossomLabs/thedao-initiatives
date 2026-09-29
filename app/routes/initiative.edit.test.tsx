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
const ME = "0x1111111111111111111111111111111111111111";
const who = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: { isAdmin: who.isAdmin, address: ME },
    requireSession: () => Promise.resolve({}),
  }),
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));
vi.mock("~/components/wallet/Identity", () => ({ default: () => null }));
vi.mock("~/components/initiative-form/InitiativeForm", () => ({
  default: function TestForm(
    { initial, onSubmit, locked, showPrivate, showTypePicker, asideTop }: InitiativeFormProps,
  ) {
    const [title, setTitle] = useState(initial!.page.title);
    return (
      <>
        {typeof asideTop === "function" ? asideTop({ empty: false }) : asideTop}
        <output aria-label="Facts">
          {locked ? "locked" : "open"}
          {showPrivate && " private"}
          {showTypePicker && " type"}
        </output>
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
        <button
          type="button"
          onClick={() =>
            void onSubmit(
              toPayload({ ...initial!, categories: [...initial!.categories, "defi"] }),
              initial!,
            )}
        >
          Add DeFi
        </button>
      </>
    );
  },
}));

beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({});
  who.isAdmin = true;
});

const feed = (row: ReturnType<typeof structuredRow>) =>
  vi.mocked(useInitiative).mockReturnValue({
    data: { initiative: row } as InitiativePage,
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  } as ReturnType<typeof useInitiative>);

function page(qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/initiative/same-url/edit"]}>
        <Routes>
          <Route path="/initiative/:slug/edit" element={<EditInitiative />} />
          <Route path="/initiative/:slug" element={<div>The public page</div>} />
          <Route path="/admin/initiatives/:slug" element={<div>The admin page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

it("an admin edits an approved initiative with the facts open, and lands back on the admin page", async () => {
  feed({
    ...structuredRow(),
    slug: "same-url",
    status: "approved" as const,
    proposer: "0x2222222222222222222222222222222222222222",
  });
  const qc = new QueryClient();
  const { unmount } = render(page(qc));
  expect(screen.getByLabelText("Facts")).toHaveTextContent("open private type");
  // the rest (status, Safe, settings, pledges) is one click away
  expect(screen.getByRole("link", { name: "Manage initiative" })).toHaveAttribute(
    "href",
    "/admin/initiatives/same-url",
  );
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText("The admin page")).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/api/initiatives/same-url", {
    method: "PATCH",
    json: expect.objectContaining({ durationMonths: "7" }),
  });
  unmount();
  qc.clear();
});

it("the proposer of an approved initiative keeps the facts locked and lands on the public page", async () => {
  who.isAdmin = false;
  feed({ ...structuredRow(), slug: "same-url", status: "approved" as const, proposer: ME });
  const qc = new QueryClient();
  const { unmount } = render(page(qc));
  expect(screen.getByLabelText("Facts")).toHaveTextContent(/^locked$/);
  expect(screen.queryByRole("link", { name: "Manage initiative" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A proposer's new title" } });
  fireEvent.click(screen.getByText("Save"));
  expect(await screen.findByText("The public page")).toBeInTheDocument();
  expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith("/api/initiatives/same-url/revisions", expect.anything());
  unmount();
  qc.clear();
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

it("a category-only change PATCHes the categories and posts no revision", async () => {
  who.isAdmin = false;
  const row = {
    ...structuredRow(),
    slug: "same-url",
    status: "approved" as const,
    proposer: ME,
    categories: ["opsec"],
  };
  feed(row);
  const qc = new QueryClient();
  const { unmount } = render(page(qc));
  fireEvent.click(screen.getByText("Add DeFi"));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/initiatives/same-url", {
      method: "PATCH",
      json: { categories: ["opsec", "defi"], initiativeId: row.id },
    })
  );
  expect(api).toHaveBeenCalledTimes(1);
  unmount();
  qc.clear();
});
