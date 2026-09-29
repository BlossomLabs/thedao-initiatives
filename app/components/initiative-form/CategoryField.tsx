import CategoriesPicker from "./CategoriesPicker";
import { FieldMsg, useFinding } from "./findings";
import type { Draft } from "./types";
import type { DraftActions } from "./useDraft";
import { useCategorySuggestion } from "./useCategorySuggestion";

/** The form's categories question: the draft's list, its findings, and (on
 * submit) the AI suggestion for the title and summary while the list is empty. */
export default function CategoryField(
  { draft, actions, suggest }: { draft: Draft; actions: DraftActions; suggest?: boolean },
) {
  const f = useFinding("categories");
  const suggestion = useCategorySuggestion({
    title: draft.page.title,
    summary: draft.page.summary,
    enabled: Boolean(suggest) && !draft.categories.length,
  });
  return (
    <CategoriesPicker
      id="f-categories"
      value={draft.categories}
      onChange={actions.setCategories}
      suggestion={suggestion}
      invalid={f.errors.length > 0}
      message={<FieldMsg field="categories" />}
    />
  );
}
