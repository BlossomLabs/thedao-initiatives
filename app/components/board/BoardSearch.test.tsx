import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import BoardSearch from "./BoardSearch";
import { type BoardView, DEFAULT_VIEW } from "~/lib/board-view";

const api = vi.fn();
vi.mock("~/lib/api", async (original) => ({
  ...(await original<typeof import("~/lib/api")>()),
  api: (...a: unknown[]) => api(...a),
}));
beforeEach(() => api.mockReset());

// The board around the box: its filters and the AI order.
const board = { view: DEFAULT_VIEW as BoardView, matches: null as string[] | null };
function Host(
  { aiEnabled = true, start = {} }: { aiEnabled?: boolean; start?: Partial<BoardView> },
) {
  const [view, setView] = useState<BoardView>({ ...DEFAULT_VIEW, ...start });
  const [matches, setMatches] = useState<string[] | null>(null);
  board.view = view;
  board.matches = matches;
  return (
    <>
      <BoardSearch
        view={view}
        onFilter={(next) => setView((v) => ({ ...v, ...next }))}
        aiEnabled={aiEnabled}
        active={Boolean(matches?.length)}
        onMatches={setMatches}
      />
      {/* stand-ins for a pill and for a manual sort */}
      <button type="button" onClick={() => setView((v) => ({ ...v, type: "rfp" }))}>
        RFPs pill
      </button>
      <button type="button" onClick={() => setMatches(null)}>Manual sort</button>
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
  api.mockResolvedValue({ matches: ["a", "b"] });
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
  expect(screen.getByRole("status")).toHaveTextContent(/AI matches first/);
});

it("Esc, editing the text, or a manual sort go back to keywords", async () => {
  api.mockResolvedValue({ matches: ["a"] });
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
  api.mockResolvedValue({ matches: [] });
  render(<Host />);
  type("nothing like this");
  enter();
  expect(await screen.findByText(/No clear AI matches/)).toBeInTheDocument();
  expect(board.view.q).toBe("nothing like this");
});

it("the later of two AI searches wins even when the first answers last", async () => {
  let first!: (v: { matches: string[] }) => void;
  const pending = new Promise<{ matches: string[] }>((r) => (first = r));
  api.mockReturnValueOnce(pending).mockResolvedValueOnce({ matches: ["b"] });
  render(<Host />);
  type("fuzzing tools");
  enter();
  type("wallet security");
  enter();
  await waitFor(() => expect(board.matches).toEqual(["b"]));
  await act(async () => {
    first({ matches: ["a"] });
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
