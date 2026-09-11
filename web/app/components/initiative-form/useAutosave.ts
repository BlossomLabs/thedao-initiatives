/**
 * Autosave to this browser only, so a closed tab does not lose an hour of
 * work. Debounced 400 ms; logo files and upload receipts never persist.
 * Restore happens once on mount; the form shows a banner with Discard.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft } from "./types";
import { emptyDraft, isEmptyDraft, newId } from "./useDraft";

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
    milestoneReviewer: String(s.milestoneReviewer ?? ""),
    page: { ...base.page, ...(s.page && typeof s.page === "object" ? s.page : {}) },
    sections: s.sections && typeof s.sections === "object" ? { ...s.sections } : {},
    priv: { ...base.priv, ...(s.priv && typeof s.priv === "object" ? s.priv : {}) },
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

export function readAutosave(key = AUTOSAVE_KEY): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? reviveDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(key = AUTOSAVE_KEY) {
  try {
    localStorage.removeItem(key);
  } catch { /* storage blocked: fine */ }
}

/**
 * `key` null disables everything (edit pages). `onRestore` receives the
 * stored draft once, on mount, when there is one with text in it.
 */
export function useAutosave(
  draft: Draft,
  { key = AUTOSAVE_KEY, onRestore }: { key?: string | null; onRestore: (d: Draft) => void },
) {
  const [restored, setRestored] = useState(false);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const armed = useRef(false);

  useEffect(() => {
    if (!key) return;
    const stored = readAutosave(key);
    if (stored) {
      restoreRef.current(stored);
      setRestored(true);
    }
    armed.current = true;
  }, [key]);

  useEffect(() => {
    if (!key || !armed.current) return;
    const t = setTimeout(() => {
      try {
        if (isEmptyDraft(draft)) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(snapshot(draft)));
      } catch { /* storage blocked: fine */ }
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, key]);

  const clear = useCallback(() => {
    if (key) clearAutosave(key);
    setRestored(false);
  }, [key]);

  return { restored, clear, dismiss: () => setRestored(false) };
}
