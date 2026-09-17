import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { AUTOSAVE_DELAY, reviveDraft, snapshot, useAutosave } from "./useAutosave";
import { emptyBacker, emptyDraft } from "./useDraft";
import type { Draft } from "./types";

const KEY = "test:draft";

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a debounced snapshot without logo files or receipts", () => {
    const onRestore = vi.fn();
    const first = emptyDraft();
    const { rerender } = renderHook(({ d }) => useAutosave(d, { key: KEY, onRestore }), {
      initialProps: { d: first },
    });
    const next: Draft = { ...first, page: { ...first.page, title: "Typed title" } };
    next.backers = [{
      ...emptyBacker(),
      org: "EF",
      logo: new File(["x"], "logo.png", { type: "image/png" }),
      logoCid: "bafy",
    }];
    rerender({ d: next });
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY);
    });
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.page.title).toBe("Typed title");
    expect(stored.backers[0]).toMatchObject({ org: "EF", logo: null, logoCid: "" });
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("restores a stored draft on mount and clears on demand", () => {
    const d = emptyDraft();
    d.page.title = "Saved before";
    d.sections.why = "why";
    localStorage.setItem(KEY, JSON.stringify(snapshot(d)));
    const onRestore = vi.fn();
    const { result } = renderHook(() => useAutosave(emptyDraft(), { key: KEY, onRestore }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0][0].page.title).toBe("Saved before");
    expect(onRestore.mock.calls[0][0].sections.why).toBe("why");
    expect(result.current.restored).toBe(true);
    act(() => result.current.clear());
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.restored).toBe(false);
  });

  it("ignores an empty or broken snapshot, and does nothing without a key", () => {
    localStorage.setItem(KEY, "{not json");
    const onRestore = vi.fn();
    renderHook(() => useAutosave(emptyDraft(), { key: KEY, onRestore }));
    expect(onRestore).not.toHaveBeenCalled();
    localStorage.setItem(KEY, JSON.stringify(snapshot(emptyDraft())));
    renderHook(() => useAutosave(emptyDraft(), { key: KEY, onRestore }));
    expect(onRestore).not.toHaveBeenCalled();
    const d = emptyDraft();
    d.page.title = "x";
    renderHook(() => useAutosave(d, { key: null, onRestore }));
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY * 2);
    });
    expect(localStorage.getItem(AUTOSAVE_KEY_NEVER)).toBeNull();
  });

  it("reviveDraft tolerates shape drift", () => {
    expect(reviveDraft(null)).toBeNull();
    expect(reviveDraft({ type: "grant", topup: true, page: { title: "t" } })).toMatchObject({
      type: "grant",
      topup: true,
      page: { title: "t", summary: "" },
    });
    const r = reviveDraft({ page: { title: "t" }, milestones: [{ name: "A", criteria: [] }] })!;
    expect(r.milestones[0].criteria).toHaveLength(1);
    expect(r.milestones[0].id).toBeTruthy();
  });
});

const AUTOSAVE_KEY_NEVER = "thedao:submit-draft";

it("does not resurrect a cleared draft from a pending autosave", async () => {
  const { deletePrivateDraft } = await import("~/lib/browser-privacy");
  vi.useFakeTimers();
  const d = emptyDraft();
  d.priv.contact = "private@example.test";
  const { unmount } = renderHook(() =>
    useAutosave(d, { key: "thedao:submit-draft:viewer", onRestore: vi.fn() })
  );
  deletePrivateDraft("viewer");
  act(() => {
    vi.advanceTimersByTime(AUTOSAVE_DELAY * 2);
  });
  expect(localStorage.getItem("thedao:submit-draft:viewer")).toBeNull();
  unmount();
  expect(localStorage.getItem("thedao:submit-draft:viewer")).toBeNull();
  vi.useRealTimers();
});

it("flushes the last keystrokes before switching wallets or showing the logout choice", async () => {
  const { flushPrivateDrafts } = await import("~/lib/browser-privacy");
  vi.useFakeTimers();
  const first = emptyDraft();
  const { rerender, unmount } = renderHook(({ d }) =>
    useAutosave(d, {
      key: "thedao:submit-draft:wallet-a",
      onRestore: vi.fn(),
    }), { initialProps: { d: first } });
  const typed = { ...first, page: { ...first.page, title: "Last keystrokes" } };
  rerender({ d: typed });
  flushPrivateDrafts();
  expect(JSON.parse(localStorage.getItem("thedao:submit-draft:wallet-a")!).page.title).toBe(
    "Last keystrokes",
  );
  unmount();
  expect(JSON.parse(localStorage.getItem("thedao:submit-draft:wallet-a")!).page.title).toBe(
    "Last keystrokes",
  );
  vi.useRealTimers();
});

it("restores only the selected wallet's draft", () => {
  const first = emptyDraft();
  first.page.title = "Wallet A private draft";
  const second = emptyDraft();
  second.page.title = "Wallet B private draft";
  localStorage.setItem("thedao:submit-draft:wallet-a", JSON.stringify(snapshot(first)));
  localStorage.setItem("thedao:submit-draft:wallet-b", JSON.stringify(snapshot(second)));
  const onRestore = vi.fn();
  const { unmount } = renderHook(() =>
    useAutosave(second, { key: "thedao:submit-draft:wallet-b", onRestore })
  );
  expect(onRestore).toHaveBeenCalledWith(
    expect.objectContaining({ page: expect.objectContaining({ title: "Wallet B private draft" }) }),
  );
  unmount();
  expect(JSON.parse(localStorage.getItem("thedao:submit-draft:wallet-a")!).page.title).toBe(
    "Wallet A private draft",
  );
});
