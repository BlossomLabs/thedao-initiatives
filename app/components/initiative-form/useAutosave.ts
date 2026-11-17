/** Private server autosave. The browser holds draft content only in memory. */
import {
  cancelDraftWrites,
  draftPath,
  draftVersion,
  readPrivateDraft,
  registerDraftFlusher,
} from "~/lib/browser-privacy";
import { api, errorMessage } from "~/lib/api";
import type { SavedDraft } from "@shared/draft/autosave";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft } from "./types";
import { emptyDraft, isEmptyDraft, newId } from "./useDraft";
import { normaliseCategories } from "~/lib/categories";

export const AUTOSAVE_KEY = "thedao:submit-draft";
export const AUTOSAVE_DELAY = 400;

/** The draft without anything that cannot be a JSON string. */
export function snapshot(d: Draft): Draft {
  return { ...d, backers: d.backers.map((b) => ({ ...b, logo: null, logoCid: "" })) };
}

/** A stored snapshot back into a draft; shape drift falls back to defaults. */
export function reviveDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Draft>;
  const base = emptyDraft();
  const d: Draft = {
    ...base,
    type: s.type === "grant" ? "grant" : "rfp",
    topup: s.type === "grant" && Boolean(s.topup),
    categories: Array.isArray(s.categories) ? normaliseCategories(s.categories) : [],
    milestoneReviewer: String(s.milestoneReviewer ?? ""),
    page: Object.fromEntries(
      Object.entries(base.page).map((
        [k, v],
      ) => [k, String(s.page?.[k as keyof Draft["page"]] ?? v)]),
    ) as unknown as Draft["page"],
    sections: s.sections && typeof s.sections === "object"
      ? Object.fromEntries(Object.entries(s.sections).map(([k, v]) => [k, String(v ?? "")]))
      : {},
    priv: { funders: String(s.priv?.funders ?? ""), contact: String(s.priv?.contact ?? "") },
    unsorted: String(s.unsorted ?? ""),
    milestones: Array.isArray(s.milestones)
      ? s.milestones.map((m) => ({
        id: newId(),
        name: String(m?.name ?? ""),
        amount: String(m?.amount ?? ""),
        adoption: Boolean(m?.adoption),
        done: Boolean(m?.done),
        link: String(m?.link ?? ""),
        month: String(m?.month ?? ""),
        criteria: (Array.isArray(m?.criteria) && m.criteria.length ? m.criteria : [{ text: "" }])
          .map((c) => ({ id: newId(), text: String(c?.text ?? "") })),
      }))
      : base.milestones,
    backers: Array.isArray(s.backers)
      ? s.backers.map((b) => ({
        id: newId(),
        org: String(b?.org ?? ""),
        amount: String(b?.amount ?? ""),
        url: String(b?.url ?? ""),
        logo: null,
        logoCid: "",
      }))
      : [],
  };
  if (!d.milestones.length) d.milestones = base.milestones;
  return isEmptyDraft(d) ? null : d;
}

export function useAutosave(
  draft: Draft,
  { key = AUTOSAVE_KEY, onRestore }: { key?: string | null; onRestore: (d: Draft) => void },
) {
  const owner = key?.startsWith(AUTOSAVE_KEY + ":") ? key.slice(AUTOSAVE_KEY.length + 1) : null;
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(draft);
  latest.current = draft;
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const state = useRef<
    {
      key: string;
      epoch: number;
      version: string | null;
      saved: string;
      blocked: boolean;
      ignored?: Draft;
    } | null
  >(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback(async () => {
    const current = state.current;
    if (
      !owner || !current || current.blocked || current.ignored === latest.current ||
      current.epoch !== draftVersion(current.key)
    ) return;
    const data = isEmptyDraft(latest.current) ? null : snapshot(latest.current);
    const text = JSON.stringify(data);
    const run = queue.current.then(async () => {
      if (
        current !== state.current || current.epoch !== draftVersion(current.key) ||
        text === current.saved
      ) return;
      const result = await api<SavedDraft>(draftPath(owner), {
        method: "PUT",
        json: { version: current.version, data },
        signal: AbortSignal.timeout(15_000),
      });
      current.version = result.version;
      current.saved = text;
      setError("");
    });
    queue.current = run;
    try {
      await run;
    } catch (e) {
      current.blocked = true;
      setError(errorMessage(e));
      throw e;
    }
  }, [owner]);

  useEffect(() => {
    state.current = null;
    queue.current = Promise.resolve();
    setReady(false);
    setRestored(false);
    setError("");
    if (!owner || !key) return;
    let mounted = true;
    const initial = latest.current;
    const epoch = draftVersion(key);
    void readPrivateDraft(owner).then((saved) => {
      if (!mounted || epoch !== draftVersion(key)) return;
      const stored = reviveDraft(saved.data);
      if (stored && latest.current !== initial && !isEmptyDraft(latest.current)) {
        setError("A saved draft exists. Reload before editing so it can be restored.");
        return;
      }
      state.current = {
        key,
        epoch,
        version: saved.version,
        saved: JSON.stringify(saved.data),
        blocked: false,
      };
      if (stored) {
        latest.current = stored;
        restoreRef.current(stored);
        setRestored(true);
      }
      setReady(true);
    }).catch((e) => {
      if (mounted) setError(errorMessage(e));
    });
    const unregister = registerDraftFlusher(key, async () => {
      if (!state.current) {
        throw new Error(
          "Your saved draft has not loaded. Please wait or reload before logging out.",
        );
      }
      if (state.current.blocked) {
        throw new Error(
          "Your latest draft has not been saved. Keep this tab open and resolve the autosave error first.",
        );
      }
      await save();
    });
    return () => {
      mounted = false;
      void save().catch(() => {});
      unregister();
    };
  }, [key, owner, save]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void save().catch(() => {}), AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [draft, ready, save]);

  const clear = useCallback(async () => {
    const current = state.current;
    if (!owner || !current) return;
    cancelDraftWrites(current.key);
    current.ignored = latest.current;
    try {
      await queue.current.catch(() => {});
      const saved = await readPrivateDraft(owner);
      // Do not silently delete a different tab's newer work.
      if (saved.version !== current.version) {
        throw new Error("This draft changed in another tab. Reload before deleting it.");
      }
      const result = await api<SavedDraft>(draftPath(owner), {
        method: "DELETE",
        json: { version: saved.version },
        signal: AbortSignal.timeout(15_000),
      });
      current.version = result.version;
      current.saved = "null";
      current.blocked = false;
      current.epoch = draftVersion(current.key);
      queue.current = Promise.resolve();
      setRestored(false);
      setError("");
    } catch (e) {
      current.blocked = true;
      setError(errorMessage(e));
      throw e;
    }
  }, [owner]);
  return { restored, error, clear, dismiss: () => setRestored(false) };
}
