import type { AiSearchResult } from "../../../shared/ai-search";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BoardSearch from "./BoardSearch";
import { type BoardView, DEFAULT_VIEW } from "~/lib/board-view";

const api = vi.fn();
vi.mock("~/lib/api", async (original) => ({
  ...(await original<typeof import("~/lib/api")>()),
  api: (...a: unknown[]) => api(...a),
}));
const upgradeNow = vi.fn(() => false);
vi.mock("~/lib/app-upgrade", () => ({ upgradeNow: () => upgradeNow() }));
beforeEach(() => {
  api.mockReset();
  upgradeNow.mockReset().mockReturnValue(false);
});
afterEach(() => vi.useRealTimers());

// The board around the box: its filters and the AI order.
const board = { view: DEFAULT_VIEW as BoardView, matches: null as string[] | null };
function Host(
  { aiEnabled = true, aiAuto = false, start = {} }: {
    aiEnabled?: boolean;
    aiAuto?: boolean;
    start?: Partial<BoardView>;
  },
) {
  const [view, setView] = useState<BoardView>({ ...DEFAULT_VIEW, ...start });
  const [result, setResult] = useState<AiSearchResult | null>(null);
  board.view = view;
  board.matches = result?.scores.map(({ id }) => id) ?? null;
  return (
    <>
      <BoardSearch
        view={view}
        onFilter={(next) => setView((v) => ({ ...v, ...next }))}
        aiEnabled={aiEnabled}
        aiAuto={aiAuto}
        active={Boolean(result?.scores.length)}
        onResults={setResult}
      />
      {/* stand-ins for a pill and for a manual sort */}
      <button type="button" onClick={() => setView((v) => ({ ...v, type: "rfp" }))}>
        RFPs pill
      </button>
      <button type="button" onClick={() => setResult(null)}>Manual sort</button>
      <button type="button" onClick={() => setView((v) => ({ ...v, sort: "newest" }))}>
        Newest sort
      </button>
    </>
  );
}

const box = () => screen.getByRole("searchbox", { name: /Search initiatives/ });
const type = (q: string) => fireEvent.change(box(), { target: { value: q } });
const enter = () => fireEvent.submit(box().closest("form")!);

it("typing filters by keywords at once, and qualifiers move the filters", () => {
  render(<Host />);
  type("wallet type:grant cat:opsec funding:open");
  expect(board.view).toMatchObject({
    q: "wallet",
    type: "grant",
    cats: ["opsec"],
    status: "open",
  });
  expect(api).not.toHaveBeenCalled(); // no AI until Enter
  expect(screen.getAllByText("Ask AI", { selector: "span" })).toHaveLength(2); // the ↵ hint + the button
});

it("a pill writes its qualifier into the box and keeps the words", () => {
  render(<Host />);
  type("wallet");
  fireEvent.click(screen.getByRole("button", { name: "RFPs pill" }));
  expect(box()).toHaveValue("wallet type:rfp");
});

it("the box starts from the URL's filters", () => {
  render(<Host start={{ q: "safe", type: "grant" }} />);
  expect(box()).toHaveValue("safe type:grant");
});

it("Enter asks the AI with the words only; its picks lead and the keywords stop filtering", async () => {
  api.mockResolvedValue({
    scores: [{ "id": "a", "score": 0.9 }, { "id": "b", "score": 0.9 }],
    pickThreshold: 0.8,
  });
  render(<Host />);
  type("hardware wallets for newcomers type:grant");
  enter();
  await waitFor(() => expect(board.matches).toEqual(["a", "b"]));
  expect(api).toHaveBeenCalledWith("/api/ai-search", {
    json: { query: "hardware wallets for newcomers" },
  });
  expect(board.view.q).toBe("hardware wallets for newcomers"); // kept; the board sets it aside
  expect(board.view.type).toBe("grant"); // qualifiers still filter
  expect(screen.getByText("AI matches", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/ordered by relevance/);
});

it("Esc, editing the text, or a manual sort go back to keywords", async () => {
  api.mockResolvedValue({ scores: [{ "id": "a", "score": 0.9 }], pickThreshold: 0.8 });
  render(<Host />);
  type("fuzzing tools");
  enter();
  await waitFor(() => expect(board.matches).toEqual(["a"]));
  fireEvent.keyDown(box(), { key: "Escape" });
  expect(board.matches).toBeNull();
  expect(board.view.q).toBe("fuzzing tools");

  enter();
  await waitFor(() => expect(board.matches).toEqual(["a"]));
  type("fuzzing tool");
  expect(board.matches).toBeNull();
  expect(board.view.q).toBe("fuzzing tool");

  enter();
  await waitFor(() => expect(board.matches).toEqual(["a"]));
  fireEvent.click(screen.getByRole("button", { name: "Manual sort" }));
  await waitFor(() => expect(board.view.q).toBe("fuzzing tool"));
  expect(screen.queryByText("AI matches", { selector: "span" })).toBeNull();
});

it("no clear AI matches: says so and keeps filtering by the keywords", async () => {
  api.mockResolvedValue({ scores: [], pickThreshold: 0.8 });
  render(<Host />);
  type("nothing like this");
  enter();
  expect(await screen.findByText(/No initiatives to rank/)).toBeInTheDocument();
  expect(board.view.q).toBe("nothing like this");
});

it("the later of two AI searches wins even when the first answers last", async () => {
  let first!: (v: AiSearchResult) => void;
  const pending = new Promise<AiSearchResult>((r) => (first = r));
  api.mockReturnValueOnce(pending).mockResolvedValueOnce({
    scores: [{ "id": "b", "score": 0.9 }],
    pickThreshold: 0.8,
  });
  render(<Host />);
  type("fuzzing tools");
  enter();
  type("wallet security");
  enter();
  await waitFor(() => expect(board.matches).toEqual(["b"]));
  await act(async () => {
    first({ scores: [{ "id": "a", "score": 0.9 }], pickThreshold: 0.8 });
    await pending;
  });
  expect(board.matches).toEqual(["b"]);
});

it("an unknown qualifier value is named under the box", () => {
  render(<Host />);
  type("type:loan");
  expect(screen.getByText(/Unknown type: loan/)).toBeInTheDocument();
});

it("without AI: just the keyword box, no Ask AI", () => {
  render(<Host aiEnabled={false} />);
  expect(screen.queryByRole("button", { name: "Ask AI" })).toBeNull();
  type("wallet");
  enter();
  expect(api).not.toHaveBeenCalled();
  expect(board.view.q).toBe("wallet");
});

const result = { scores: [{ id: "a", score: 0.9 }], pickThreshold: 0.8 };
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

it("Jev debounces typing and sends only the latest words", async () => {
  vi.useFakeTimers();
  api.mockResolvedValue(result);
  render(<Host aiAuto />);
  type("sol");
  await tick(300);
  type("solidity cat:opsec");
  await tick(499);
  expect(api).not.toHaveBeenCalled();
  await tick(1);
  expect(api).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith("/api/ai-search", { json: { query: "solidity" } });
  expect(board.matches).toEqual(["a"]);
  expect(screen.queryByText(/Initiatives ordered by relevance/)).toBeNull();
  expect(screen.queryByText("Back to keywords")).toBeNull();
  expect(board.view.cats).toEqual(["opsec"]);
  fireEvent.click(screen.getByRole("button", { name: "RFPs pill" }));
  await tick(600);
  expect(api).toHaveBeenCalledTimes(1);
  expect(board.matches).toEqual(["a"]);
});

it("Jev automatically searches a query restored from the URL", async () => {
  vi.useFakeTimers();
  api.mockResolvedValue(result);
  render(<Host aiAuto start={{ q: "solidity" }} />);
  await tick(500);
  expect(api).toHaveBeenCalledWith("/api/ai-search", { json: { query: "solidity" } });
});

it.each(["zk", "ZK"])("Jev accepts the short zero-knowledge query %s", async (query) => {
  vi.useFakeTimers();
  api.mockResolvedValue(result);
  render(<Host aiAuto />);
  type(query);
  await tick(500);
  expect(api).toHaveBeenCalledWith("/api/ai-search", { json: { query: "zk" } });
  expect(board.matches).toEqual(["a"]);
});

it("LLM search also accepts zk on Enter", async () => {
  api.mockResolvedValue(result);
  render(<Host />);
  type("zk");
  enter();
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/ai-search", { json: { query: "zk" } })
  );
});

it("editing or clearing rejects an in-flight response before the next debounce fires", async () => {
  vi.useFakeTimers();
  let finish!: (value: AiSearchResult) => void;
  api.mockReturnValueOnce(
    new Promise<AiSearchResult>((resolve) => {
      finish = resolve;
    }),
  )
    .mockResolvedValue(result);
  render(<Host aiAuto />);
  type("solidity");
  await tick(500);
  type("wallets");
  await act(async () => {
    finish(result);
    await Promise.resolve();
  });
  expect(board.matches).toBeNull();
  type("");
  await tick(600);
  expect(api).toHaveBeenCalledTimes(1);
  expect(board.matches).toBeNull();
  type("ab");
  await tick(600);
  expect(api).toHaveBeenCalledTimes(1);
});

it("Enter flushes the Jev debounce without a duplicate request", async () => {
  vi.useFakeTimers();
  api.mockResolvedValue(result);
  render(<Host aiAuto />);
  type("solidity");
  enter();
  await tick(600);
  expect(api).toHaveBeenCalledTimes(1);
});

it("Esc and manual sorting do not immediately restart automatic search", async () => {
  vi.useFakeTimers();
  api.mockResolvedValue(result);
  render(<Host aiAuto />);
  type("solidity");
  fireEvent.keyDown(box(), { key: "Escape" });
  await tick(600);
  expect(api).not.toHaveBeenCalled();
  type("wallets");
  await tick(500);
  expect(board.matches).toEqual(["a"]);
  fireEvent.click(screen.getByRole("button", { name: "Manual sort" }));
  await tick(600);
  expect(board.matches).toBeNull();
  expect(api).toHaveBeenCalledTimes(1);
});

it("unmounting cancels a scheduled automatic search", async () => {
  vi.useFakeTimers();
  const { unmount } = render(<Host aiAuto />);
  type("solidity");
  unmount();
  await tick(600);
  expect(api).not.toHaveBeenCalled();
});

it("a manual sort cancels the pending Jev debounce", async () => {
  vi.useFakeTimers();
  render(<Host aiAuto />);
  type("solidity");
  fireEvent.click(screen.getByRole("button", { name: "Newest sort" }));
  await tick(600);
  expect(api).not.toHaveBeenCalled();
});

it.each([null, {}, { scores: undefined }, { matches: ["a"] }])(
  "an answer without scores (%j) reads as plain words and the keywords keep filtering",
  async (answer) => {
    api.mockResolvedValue(answer);
    render(<Host />);
    type("monad would like these");
    enter();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Search is unavailable right now. Refresh the page and try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/undefined|properties/);
    expect(board.matches).toBeNull();
    expect(board.view.q).toBe("monad would like these");
  },
);

it("an answer this build cannot read reloads onto the new build instead of failing", async () => {
  upgradeNow.mockReturnValue(true);
  api.mockResolvedValue({ ranking: [] });
  render(<Host />);
  type("monad would like these");
  enter();
  await waitFor(() => expect(upgradeNow).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(board.view.q).toBe("monad would like these"); // in the URL, so the reload keeps it
});
