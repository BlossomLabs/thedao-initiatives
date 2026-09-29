import { useEffect, useRef, useState } from "react";
import { api } from "~/lib/api";
import { normaliseCategories } from "~/lib/categories";

const PAUSE = 1200;

/**
 * The AI's categories for a title and summary, offered and never applied: the
 * form shows them with "Use suggestions". An answer counts only for the exact
 * text it was asked about, so a response that arrives after an edit is dropped
 * and an edit withdraws a shown suggestion. Answers are cached per text.
 */
export function useCategorySuggestion(
  { title, summary, enabled }: { title: string; summary: string; enabled: boolean },
): string[] | null {
  const t = title.trim();
  const s = summary.trim();
  const source = `${t}\n${s}`;
  const ready = enabled && t.length >= 8 && s.length >= 20;
  const cache = useRef(new Map<string, string[]>());
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!ready || cache.current.has(source)) return;
    let live = true;
    const timer = setTimeout(() => {
      api<{ categories: string[] }>("/api/ai-categories", { json: { title: t, summary: s } })
        .then(({ categories }) => normaliseCategories(categories))
        .catch(() => [] as string[])
        .then((slugs) => {
          cache.current.set(source, slugs);
          if (live) rerender((n) => n + 1);
        });
    }, PAUSE);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ready, source]);

  const hit = ready ? cache.current.get(source) : undefined;
  return hit?.length ? hit : null;
}
