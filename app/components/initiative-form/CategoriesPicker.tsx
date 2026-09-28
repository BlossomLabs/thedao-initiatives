import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { CategoryChip, CategoryTag } from "~/components/ui/CategoryTag";
import { api } from "~/lib/api";
import { CATEGORIES, categoryOf, MAX_CATEGORIES } from "~/lib/categories";

/**
 * Pick 1 to 3 categories; the first is the main topic. With `suggestFrom`,
 * once a title and summary are typed and nothing is picked yet, the AI
 * pre-selects its suggestion, marked "Suggested", for the submitter to accept
 * or change. A failed suggestion leaves the question empty (and required).
 */
export default function CategoriesPicker({
  value,
  onChange,
  suggestFrom,
  error,
  disabled,
  label = "Categories",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestFrom?: { title: string; summary: string };
  error?: string;
  disabled?: boolean;
  label?: string;
}) {
  const [suggested, setSuggested] = useState(false);
  const asked = useRef("");
  const title = suggestFrom?.title.trim() ?? "";
  const summary = suggestFrom?.summary.trim() ?? "";

  useEffect(() => {
    if (!suggestFrom || value.length || title.length < 8 || summary.length < 20) return;
    const key = title + "\n" + summary;
    if (asked.current === key) return;
    const t = setTimeout(() => {
      asked.current = key;
      api<{ categories: string[] }>("/api/ai-categories", { json: { title, summary } })
        .then(({ categories }) => {
          const valid = categories.filter((s) => categoryOf(s)).slice(0, MAX_CATEGORIES);
          if (valid.length) {
            onChange(valid);
            setSuggested(true);
          }
        })
        .catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [Boolean(suggestFrom), value.length, title, summary]);

  const toggle = (slug: string) => {
    setSuggested(false);
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);
  };
  const makeMain = (slug: string) => {
    setSuggested(false);
    onChange([slug, ...value.filter((s) => s !== slug)]);
  };
  const full = value.length >= MAX_CATEGORIES;

  return (
    <div className="mt-4" data-field="categories" id="categories" tabIndex={-1}>
      <span className="label">
        {label} *
        {suggested && (
          <span className="ml-2 rounded-full bg-[rgba(92,183,90,.15)] px-2 py-0.5 text-[11px] normal-case tracking-normal text-dao-green">
            Suggested
          </span>
        )}
      </span>
      <p className="hint m-0 mb-2">Pick 1 to 3. The first one is the main topic.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c.slug}
            slug={c.slug}
            selected={value.includes(c.slug)}
            disabled={disabled || (full && !value.includes(c.slug))}
            title={c.description}
            onToggle={() => toggle(c.slug)}
          />
        ))}
      </div>
      {value.length > 1 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 small dim">
          Main topic: <CategoryTag slug={value[0]} />
          {value.slice(1).map((slug) => (
            <button
              key={slug}
              type="button"
              disabled={disabled}
              className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-white/60 underline hover:text-white"
              onClick={() => makeMain(slug)}
            >
              <Star className="size-3" aria-hidden="true" /> make {categoryOf(slug)?.label} main
            </button>
          ))}
        </div>
      )}
      {error && <p className="fld-msg fld-err" role="alert">{error}</p>}
    </div>
  );
}
