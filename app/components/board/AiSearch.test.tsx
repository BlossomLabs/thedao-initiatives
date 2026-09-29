import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import AiSearch from "./AiSearch";

const api = vi.fn();
vi.mock("~/lib/api", async (original) => ({
  ...(await original<typeof import("~/lib/api")>()),
  api: (...a: unknown[]) => api(...a),
}));
beforeEach(() => api.mockReset());

const type = (q: string) =>
  fireEvent.change(screen.getByRole("textbox", { name: /security work/ }), {
    target: { value: q },
  });
const submit = () =>
  fireEvent.submit(screen.getByRole("button", { name: "Find matches" }).closest("form")!);

it("is labelled Find matches and keeps its original placeholder", () => {
  render(<AiSearch active={false} onMatches={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Find matches" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /security work/ }).getAttribute("placeholder"))
    .toBe(
      "What kind of security work do you want to fund? Describe it and we'll surface the best matches.",
    );
});

it("after a search, says the matches moved first and the filters still apply", async () => {
  api.mockResolvedValue({ matches: ["a"] });
  render(<AiSearch active={false} onMatches={vi.fn()} />);
  type("fuzzing tools");
  submit();
  const note = await screen.findByRole("status");
  expect(note).toHaveTextContent(/moved to the front/);
  expect(note).toHaveTextContent(/filters still apply/);
});
it("the later of two searches wins even when the first answers last", async () => {
  let first!: (v: { matches: string[] }) => void;
  const pending = new Promise<{ matches: string[] }>((r) => (first = r));
  api.mockReturnValueOnce(pending).mockResolvedValueOnce({ matches: ["b"] });
  const onMatches = vi.fn();
  render(<AiSearch active={false} onMatches={onMatches} />);
  type("fuzzing tools");
  submit();
  type("wallet security");
  submit();
  await waitFor(() => expect(onMatches).toHaveBeenLastCalledWith(["b"]));
  await act(async () => {
    first({ matches: ["a"] });
    await pending;
  });
  expect(onMatches).not.toHaveBeenCalledWith(["a"]);
});

it("drops its note when the board clears the AI order", async () => {
  api.mockResolvedValue({ matches: ["a"] });
  const { rerender } = render(<AiSearch active={false} onMatches={vi.fn()} />);
  type("fuzzing tools");
  submit();
  rerender(<AiSearch active onMatches={vi.fn()} />);
  expect(await screen.findByText(/moved to the front/)).toBeInTheDocument();
  rerender(<AiSearch active={false} onMatches={vi.fn()} />);
  expect(screen.queryByText(/moved to the front/)).toBeNull();
});

function Host() {
  const [matches, setMatches] = useState<string[] | null>(null);
  return <AiSearch active={Boolean(matches?.length)} onMatches={setMatches} />;
}

it("a second search with no matches still says so", async () => {
  api.mockResolvedValueOnce({ matches: ["a"] }).mockResolvedValueOnce({ matches: [] });
  render(<Host />);
  type("fuzzing tools");
  submit();
  expect(await screen.findByText(/moved to the front/)).toBeInTheDocument();
  type("nothing like this");
  submit();
  expect(await screen.findByText(/No clear matches/)).toBeInTheDocument();
});
