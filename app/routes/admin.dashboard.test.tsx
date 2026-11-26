vi.mock("~/context/session", () => ({
  useSession: () => ({
    session: {
      address: "0x1111111111111111111111111111111111111111",
      isAdmin: true,
      expiresAt: 9999999999,
    },
    signOut: vi.fn(),
  }),
  sessionKey: () => "admin",
}));
vi.mock("~/lib/api", async (original) => ({
  ...await original<typeof import("~/lib/api")>(),
  api: vi.fn(),
}));
vi.mock("~/hooks/use-site-settings", () => ({ useSiteSettings: () => ({ data: undefined }) }));
vi.mock("~/components/admin/Admins", () => ({ default: () => <p>Admins box</p> }));
const round = vi.hoisted(() => ({
  contract: "0x0000000000000000000000000000000000000000",
}));
vi.mock("~/lib/vote-round", async (original) => ({
  ...await original<typeof import("~/lib/vote-round")>(),
  roundLoader: () => null,
  useRound: () => round,
}));
vi.mock("~/components/admin/vote/RoundAdminQueue", () => ({
  default: ({ env, title }: { env: string; title: string }) => <h2>{title} ({env})</h2>,
}));
vi.mock("~/context/wallet", () => ({ useWallet: () => ({ isConnected: false }) }));
vi.mock("~/components/admin/initiative/SafeCard", () => ({
  useSafeDeploy: () => ({ ensureDeployed: vi.fn(), status: null, busy: false }),
}));
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { structuredRow } from "../../test/fixtures";
import type { AdminInitiative, AdminListRow, AdminTodo, HeldComment } from "~/lib/api-types";
import { api } from "~/lib/api";
import Dashboard from "./admin.dashboard";

const summary = {
  pledged: 0,
  received: 0,
  donated: 0,
  total: 0,
  live: false,
  ledger: 0,
  paidOut: 0,
};
const row = (id: string, over: Partial<AdminInitiative>) => ({
  initiative: {
    ...structuredRow(),
    id,
    slug: `slug-${id}`,
    contact: "",
    categories: [],
    ...over,
  } as unknown as AdminInitiative,
  summary,
  safeSync: null,
});

const rows: AdminListRow[] = [
  row("1", {
    title: "Echidna fuzzing",
    type: "grant",
    status: "approved",
    contact: "Gustavo @ggrieco",
  }),
  row("2", {
    title: "Safe Lockdown Guard",
    type: "rfp",
    status: "approved",
    contact: "ops@safe.example",
  }),
  row("3", { title: "Directory of Value", type: "rfp", status: "approved" }),
  row("4", { title: "Pending grant", type: "grant", status: "pending" }),
];
const todoRow = (r: AdminListRow) => ({ ...r.initiative, pendingRevision: null });
const todo: AdminTodo = {
  submissions: [
    todoRow(row("5", { title: "Older submission", status: "pending", categories: ["tooling"] })),
    todoRow(row("4", { title: "Pending grant", type: "grant", status: "pending" })),
  ],
  edits: [],
  held: [],
  unanswered: [],
  reported: [],
  weekAgo: 0,
  index: rows.map(({ initiative: r }) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    type: r.type,
  })),
  counts: { total: 4, approved: 3, approvedThisWeek: 1 },
};
const status = {
  chain: { detail: "ok", checkedAt: 0 },
  safeApi: {
    configured: true,
    key: { source: "env", hint: "abcd", setBy: null, setAt: null, envConfigured: true },
    quota: null,
    refreshMinutes: 5,
  },
  signers: { ok: true, detail: "3 of 5", list: [], threshold: 3 },
};
const answer = (list = rows, t = todo) => (path: unknown) => {
  const p = String(path);
  if (p === "/api/admin/todo") return Promise.resolve(t);
  if (p === "/api/admin/vote-round/queue") {
    return Promise.resolve({ kind: "real", ready: [{}], toSign: [{}, {}] });
  }
  if (p === "/api/admin/status") return Promise.resolve(status);
  if (p === "/api/admin/initiatives") return Promise.resolve({ rows: list });
  return Promise.reject(new Error(`unexpected ${p}`));
};

beforeEach(() => {
  round.contract = "0x0000000000000000000000000000000000000000";
  vi.mocked(api).mockReset().mockImplementation(answer());
});

const where = { search: "", pathname: "" };
function Location() {
  const loc = useLocation();
  where.search = loc.search;
  where.pathname = loc.pathname;
  return null;
}
const mount = (url = "/admin") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Dashboard />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const box = () => screen.findByRole("searchbox", { name: "Search by project or contact" });
/** The table loads on its own, after the to-do list: wait for its search box. */
const openTable = async () => {
  await screen.findByRole("searchbox", { name: "Search by project or contact" });
};

it("the header counts the initiatives", async () => {
  mount();
  expect(await screen.findByText("4 initiatives")).toBeInTheDocument();
  expect(screen.getByText("3 approved")).toBeInTheDocument();
  expect(screen.getByText("This week: 1 approved")).toBeInTheDocument();
});

it("submissions come first, oldest first, approved from the row; untagged ones say why not", async () => {
  mount();
  const section = await screen.findByRole("region", { name: "Submissions to approve" });
  const titles = [...section.querySelectorAll("button[aria-expanded] > span:first-child")]
    .map((x) => x.textContent);
  expect(titles).toEqual(["Older submission", "Pending grant"]);
  const approve = screen.getAllByRole("button", { name: "Deploy Safe and approve" });
  // No wallet connected: the deploy needs one. The untagged one also needs a category.
  expect(approve[0]).toBeDisabled();
  expect(screen.getByText(/Add at least one category to approve\. Open the row/))
    .toBeInTheDocument();
});

it("empty queues say so", async () => {
  mount();
  expect(await screen.findByText("No edits waiting.")).toBeInTheDocument();
  expect(screen.getByText(/every question has a reply/)).toBeInTheDocument();
});

it("there is nothing to rate here: ratings are for badge holders", async () => {
  mount();
  await screen.findByText("4 initiatives");
  expect(screen.queryByText(/rated/i)).toBeNull();
});

it("the admin list is always in view: it is a security fact, not a tool behind a menu", async () => {
  mount();
  expect(await screen.findByText("Admins box")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("button", { name: "Admins" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sync content" })).toBeNull();
});

it("a hidden contact is its own button, not a banner above the table", async () => {
  vi.mocked(api).mockImplementation(answer(
    rows.map((r) => ({ ...r, initiative: { ...r.initiative, contact: undefined } })),
  ));
  mount();
  await openTable();
  const table = await screen.findByRole("table");
  expect(within(table).getAllByRole("button", { name: "Hidden" })).toHaveLength(4);
  expect(screen.queryByText(/Private contacts require/)).toBeNull();
});

it("the table loads on its own after the to-do list, with a skeleton until then", async () => {
  let release: (v: unknown) => void = () => {};
  vi.mocked(api).mockImplementation((path) =>
    String(path) === "/api/admin/initiatives"
      ? new Promise((r) => (release = () => r({ rows })))
      : answer()(path)
  );
  mount();
  expect(await screen.findByLabelText("Loading initiatives")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Show all|Hide/ })).toBeNull();
  release(undefined);
  expect(await box()).toBeInTheDocument();
});

it("the search filters the table by project or contact as you type", async () => {
  mount();
  await openTable();
  const box = await screen.findByRole("searchbox", { name: "Search by project or contact" });
  fireEvent.change(box, { target: { value: "lockdown" } });
  expect(screen.getByText("Safe Lockdown Guard")).toBeInTheDocument();
  expect(screen.queryByText("Echidna fuzzing")).toBeNull();
  expect(screen.getByText(/1 of 4/)).toBeInTheDocument();
  fireEvent.change(box, { target: { value: "ggrieco" } });
  expect(screen.getByText("Echidna fuzzing")).toBeInTheDocument();
  expect(screen.queryByText("Safe Lockdown Guard")).toBeNull();
});

it("when nothing matches, the table says so and one click clears the search", async () => {
  mount();
  await openTable();
  const box = await screen.findByRole("searchbox", { name: "Search by project or contact" });
  fireEvent.change(box, { target: { value: "nothing like this" } });
  expect(screen.getByText(/No initiatives match\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
  expect(box).toHaveValue("");
  expect(screen.getByText("Echidna fuzzing")).toBeInTheDocument();
  expect(screen.getByText(/4 of 4/)).toBeInTheDocument();
});

it("the user's example: type:grant status:pending First QA", async () => {
  mount();
  await openTable();
  fireEvent.change(await box(), { target: { value: "type:grant status:pending grant" } });
  expect(within(screen.getByRole("table")).getByText("Pending grant")).toBeInTheDocument();
  expect(screen.queryByText("Echidna fuzzing")).toBeNull();
  expect(screen.getByText(/1 of 4/)).toBeInTheDocument();
});

it("typing a qualifier moves its pill; the query lives in the URL", async () => {
  mount();
  await openTable();
  fireEvent.change(await box(), { target: { value: "status:pending" } });
  expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Pending");
  await waitFor(() => expect(where.search).toBe("?q=status%3Apending"));
});

it("picking a pill writes its qualifier into the query, keeping the words", async () => {
  mount();
  await openTable();
  const input = await box();
  fireEvent.change(input, { target: { value: "lockdown" } });
  const status = screen.getByRole("combobox", { name: "Status" });
  status.focus();
  fireEvent.keyDown(status, { key: "ArrowDown" });
  const approved = await screen.findByRole("option", { name: /Approved/ });
  for (let i = 0; i < 6 && !approved.hasAttribute("data-highlighted"); i++) {
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 20));
  }
  fireEvent.keyDown(approved, { key: "Enter" });
  expect(input).toHaveValue("lockdown status:approved");
  expect(screen.getByText("Safe Lockdown Guard")).toBeInTheDocument();
});

it("a shared URL restores the view", async () => {
  mount("/admin?q=type%3Arfp");
  expect(await box()).toHaveValue("type:rfp");
  expect(screen.getByText(/2 of 4/)).toBeInTheDocument();
  expect(screen.queryByText("Echidna fuzzing")).toBeNull();
});

it("an unknown value is named and ignored", async () => {
  mount();
  await openTable();
  fireEvent.change(await box(), { target: { value: "status:pendng" } });
  expect(screen.getByText(/Unknown status: pendng\./)).toBeInTheDocument();
  expect(screen.getByText(/4 of 4/)).toBeInTheDocument();
});

it("the untagged count fills in cat:untagged", async () => {
  mount();
  await openTable();
  await box();
  fireEvent.click(screen.getByRole("button", { name: /4 untagged/ }));
  expect(await box()).toHaveValue("cat:untagged");
});

it("edits in review: a count that fills in edit:review, and a mark on the row", async () => {
  vi.mocked(api).mockImplementation(answer(
    rows.map((r, i) => i === 1 ? { ...r, initiative: { ...r.initiative, pendingRevision: 3 } } : r),
  ));
  mount();
  await openTable();
  await box();
  fireEvent.click(screen.getByRole("button", { name: /1 edit in review/ }));
  expect(await box()).toHaveValue("edit:review");
  await waitFor(() => expect(screen.getByText(/1 of 4/)).toBeInTheDocument());
  expect(screen.getByText("edit in review")).toBeInTheDocument();
});

it("no edits in review: no count to click", async () => {
  mount();
  await openTable();
  await box();
  expect(screen.queryByRole("button", { name: /in review/ })).toBeNull();
});

const HELD_ADDR = "0x1563915e194D8CfBA1943570603F7606A3115508";
const heldRow = (over: Partial<HeldComment> = {}): HeldComment => ({
  id: "c1",
  type: "other",
  topic: "",
  body: "https://claim-airdrop.example/x",
  displayName: "",
  address: HELD_ADDR,
  roles: [],
  answered: false,
  reviewed: false,
  accepted: false,
  featured: 0,
  votes: 0,
  myvote: 0,
  createdAt: 1_800_000_000,
  replies: [],
  initiativeId: "1",
  parentId: "p1",
  status: "held",
  email: "",
  reports: 0,
  aiSummary: "",
  aiScreen: {
    verdict: null,
    nameFlag: null,
    reason: "AI screen failed: timeout: no answer in 25 s",
    error: "timeout: no answer in 25 s",
    at: 1_800_000_000,
  },
  initiative: { slug: "slug-1", title: "Echidna fuzzing" },
  context: {
    parent: {
      id: "p1",
      body: "What does the audit cover?",
      displayName: "Asker",
      address: "",
      status: "published",
    },
    author: {
      address: HELD_ADDR,
      admin: false,
      proposerOf: [{
        slug: "slug-3",
        title: "Directory of Value",
        status: "approved",
        here: false,
      }],
      backed: [{ slug: "slug-1", title: "Echidna fuzzing", usd: 25, here: true }],
      badge: false,
      comments: { published: 2, held: 1, discarded: 1 },
      firstSeen: 1_790_000_000,
    },
  },
  ...over,
} as unknown as HeldComment);

/** The to-do list counts the held rows; their thread and author come from /api/admin/held. */
const withHeld = (held: HeldComment[]) =>
  vi.mocked(api).mockImplementation((path) =>
    String(path) === "/api/admin/held"
      ? Promise.resolve({ held })
      : answer(rows, { ...todo, held })(path)
  );

it("a held reply shows its thread, the screen's reason, and who wrote it", async () => {
  withHeld([heldRow()]);
  mount();
  expect(await screen.findByText("No answer")).toBeInTheDocument();
  expect(screen.getByText("The screen failed: timeout: no answer in 25 s")).toBeInTheDocument();
  expect(screen.queryByText("AI screen error")).toBeNull();
  // The link is text, not a link, with its domain flagged.
  const body = screen.getByTestId("held-body");
  expect(body).toHaveTextContent("https://claim-airdrop.example/x");
  expect(body.querySelector("a")).toBeNull();
  expect(screen.getByText("claim-airdrop.example")).toBeInTheDocument();
  expect(screen.getByText(/not the board, a code host or a known forum/)).toBeInTheDocument();
  expect(screen.getByText("What does the audit cover?")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the thread" }))
    .toHaveAttribute("href", "/initiative/slug-1#qa-p1");
  expect(screen.getByText(HELD_ADDR)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View on the explorer" }))
    .toHaveAttribute("href", `https://eth.blockscout.com/address/${HELD_ADDR}`);
  expect(screen.getByText("Proposer of Directory of Value")).toBeInTheDocument();
  expect(screen.getByText("Backer: $25.00 to this initiative")).toBeInTheDocument();
  expect(screen.getByText("Comments: 2 published · 1 held · 1 discarded")).toBeInTheDocument();
  expect(screen.getByText("No ETHSecurity badge")).toBeInTheDocument();
});

it("re-run AI screen asks the API again for that row", async () => {
  withHeld([heldRow()]);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Re-run AI screen" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/admin/comments/c1/rescreen", { method: "POST" })
  );
});

it("an older held row without a recorded screen says how to find out why", async () => {
  withHeld([heldRow({ aiScreen: null, aiSummary: "AI screen error" })]);
  mount();
  expect(await screen.findByText(/Re-run to see why it was held/)).toBeInTheDocument();
});

it("with nothing held, the held comments are never fetched", async () => {
  mount();
  await screen.findByText("Submissions to approve");
  expect(vi.mocked(api).mock.calls.map(([p]) => String(p))).not.toContain("/api/admin/held");
});

it("with a round deployed: the Waiting for a round admin card, and a to-do line linking to it", async () => {
  round.contract = "0x1000000000000000000000000000000000000001";
  mount();
  const line = await screen.findByRole("link", {
    name: "1 initiative ready for the ballot, 2 pledges to sign",
  });
  expect(line).toHaveAttribute("href", "#round-admin");
  expect(screen.getByText("Waiting for a round admin (production)")).toBeInTheDocument();
});

it("with no round deployed: neither the card nor the line", async () => {
  mount();
  await screen.findByText("4 initiatives");
  expect(screen.queryByText(/Waiting for a round admin/)).toBeNull();
  expect(screen.queryByText(/ready for the ballot/)).toBeNull();
});
