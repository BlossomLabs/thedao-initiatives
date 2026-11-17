import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { AUTOSAVE_DELAY, reviveDraft, snapshot, useAutosave } from "./useAutosave";
import { emptyBacker, emptyDraft } from "./useDraft";
import { api, ApiError } from "~/lib/api";
import { draftKey, flushPrivateDrafts } from "~/lib/browser-privacy";
import type { Draft } from "./types";
vi.mock(
  "~/lib/api",
  async (original) => ({ ...await original<typeof import("~/lib/api")>(), api: vi.fn() }),
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const OWNER = "0x" + "11".repeat(20);
const KEY = draftKey(OWNER);
let saved: { version: string | null; data: unknown };
let revision = 0;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  saved = { version: null, data: null };
  revision = 0;
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation((_path, opts) => {
    if (opts?.method === "PUT" || opts?.method === "DELETE") {
      const body = opts.json as { version: string | null; data: unknown };
      if (body.version !== saved.version) {
        return Promise.reject(new ApiError(409, "Draft changed in another tab"));
      }
      saved = { version: String(++revision), data: opts.method === "DELETE" ? null : body.data };
    }
    return Promise.resolve(structuredClone(saved));
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

it("saves a debounced private snapshot to the owner endpoint without browser persistence", async () => {
  const onRestore = vi.fn(), first = emptyDraft();
  const { rerender } = renderHook(({ d }) => useAutosave(d, { key: KEY, onRestore }), {
    initialProps: { d: first },
  });
  await settle();
  const next: Draft = {
    ...first,
    page: { ...first.page, title: "Private title" },
    priv: { funders: "", contact: "private@example.test" },
    backers: [{
      ...emptyBacker(),
      org: "EF",
      logo: new File(["x"], "logo.png"),
      logoCid: "receipt",
    }],
  };
  rerender({ d: next });
  await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY));
  expect(saved.data).toMatchObject({
    page: { title: "Private title" },
    backers: [{ logo: null, logoCid: "" }],
  });
  expect(api).toHaveBeenCalledWith(
    `/api/draft/${OWNER}`,
    expect.objectContaining({ method: "PUT" }),
  );
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(onRestore).not.toHaveBeenCalled();
});

it("restores from the server and clears without a queued save resurrecting the draft", async () => {
  const d = emptyDraft();
  d.page.title = "Saved before";
  saved = { version: "1", data: snapshot(d) };
  revision = 1;
  const onRestore = vi.fn();
  const { result, unmount } = renderHook(() => useAutosave(d, { key: KEY, onRestore }));
  await settle();
  expect(onRestore.mock.calls[0][0].page.title).toBe("Saved before");
  expect(result.current.restored).toBe(true);
  await act(() => result.current.clear());
  await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 2));
  unmount();
  await settle();
  expect(saved.data).toBeNull();
});

it("flushes the final keystrokes before logout", async () => {
  const first = emptyDraft();
  const { rerender } = renderHook(({ d }) => useAutosave(d, { key: KEY, onRestore: vi.fn() }), {
    initialProps: { d: first },
  });
  await settle();
  rerender({ d: { ...first, page: { ...first.page, title: "Last keystrokes" } } });
  await act(() => flushPrivateDrafts());
  expect(saved.data).toMatchObject({ page: { title: "Last keystrokes" } });
});

it("does not overwrite another tab's draft after a version conflict", async () => {
  const first = emptyDraft();
  const { rerender, result } = renderHook(
    ({ d }) => useAutosave(d, { key: KEY, onRestore: vi.fn() }),
    { initialProps: { d: first } },
  );
  await settle();
  saved = { version: "other", data: { page: { title: "Other tab" } } };
  rerender({ d: { ...first, page: { ...first.page, title: "My edits" } } });
  await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY));
  expect(result.current.error).toMatch(/another tab/);
  expect(saved.data).toEqual({ page: { title: "Other tab" } });
  await expect(flushPrivateDrafts()).rejects.toThrow(/not been saved/);
});

it("ignores a read that arrives after the owner changed", async () => {
  const pending = deferred<{ version: null; data: unknown }>();
  vi.mocked(api).mockImplementationOnce(() => pending.promise);
  const onRestore = vi.fn(), d = emptyDraft();
  const { rerender } = renderHook(({ key }) => useAutosave(d, { key, onRestore }), {
    initialProps: { key: KEY },
  });
  rerender({ key: draftKey("0x" + "22".repeat(20)) });
  await settle();
  await act(() =>
    pending.resolve({ version: null, data: { page: { title: "Old wallet private draft" } } })
  );
  expect(onRestore).not.toHaveBeenCalled();
});

it("does not restore over edits typed before a slow saved draft response", async () => {
  const pending = deferred<{ version: null; data: unknown }>();
  vi.mocked(api).mockImplementationOnce(() => pending.promise);
  const onRestore = vi.fn(), first = emptyDraft();
  const { rerender, result } = renderHook(({ d }) => useAutosave(d, { key: KEY, onRestore }), {
    initialProps: { d: first },
  });
  rerender({ d: { ...first, page: { ...first.page, title: "Typing" } } });
  await act(() => pending.resolve({ version: null, data: { page: { title: "Existing draft" } } }));
  expect(onRestore).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/saved draft exists/);
});

it("does nothing without a wallet key and safely revives malformed fields", async () => {
  renderHook(() => useAutosave(emptyDraft(), { key: null, onRestore: vi.fn() }));
  await settle();
  expect(api).not.toHaveBeenCalled();
  expect(reviveDraft({ page: { title: 42 }, priv: { contact: {} } })?.page.title).toBe("42");
});

describe("categories in the autosave", () => {
  it("round-trips the categories", () => {
    const d = { ...emptyDraft(), categories: ["opsec", "defi"] };
    d.page.title = "T";
    expect(reviveDraft(JSON.parse(JSON.stringify(snapshot(d))))?.categories)
      .toEqual(["opsec", "defi"]);
  });

  it("an older saved draft without categories restores with none", () => {
    const old = { type: "rfp", page: { title: "Old draft" } };
    expect(reviveDraft(old)?.categories).toEqual([]);
  });

  it("a tampered list keeps the valid, unique first three", () => {
    const bad = {
      page: { title: "T" },
      categories: ["x", "opsec", 4, "opsec", "defi", "compilers", "sigma"],
    };
    expect(reviveDraft(bad)?.categories).toEqual(["opsec", "defi", "compilers"]);
    expect(reviveDraft({ page: { title: "T" }, categories: "opsec" })?.categories).toEqual([]);
  });
});
