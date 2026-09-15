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
