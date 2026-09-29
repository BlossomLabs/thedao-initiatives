# Category UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PR #55's category chips with a restrained UI. The board gets a compact filter toolbar, an active-filter row and a mobile filter sheet. Cards get colour dots with a popover instead of pills. The forms get one Base UI Combobox picker, and the category state moves into the form draft.

**Architecture:** The pure board logic stays in `app/lib/board-view.ts` and gains a few helpers. The toolbar is split into small components under `app/components/board/filters/`. Categories become a field of `Draft`, so autosave, restore, the checks, the preview and the payload share one source of truth. The AI suggestion becomes a hook that only offers a result, which the proposer applies explicitly. The picker, the board category dropdown, the dot popover and the sheet all use Base UI (`@base-ui/react` 1.8.0: `combobox`, `popover`, `tooltip`, `drawer`, `checkbox-group`, `radio-group`, `select`).

**Tech Stack:** React 19, React Router 7, TanStack Query, Tailwind 4, Base UI 1.8, lucide-react, vitest + Testing Library (jsdom), Deno tasks.

**Spec:** `docs/superpowers/specs/2026-09-29-category-ui-redesign.md`

**Branch:** `categories-ui`, created from `categories-p0` (PR #55). The PR targets `categories-p0`, or `main` once #55 merges. Leave the untracked `docs/security/security-reviews-2026-09.*` files alone.

## Global Constraints

- Keep the API endpoints, the category slugs and colours (`shared/categories.ts`), the validation rules (1 to 3 unique registry slugs, the first is primary) and the board URL params (`?type=&cat=&status=&sort=&view=&q=`). No database migration.
- Categories stay out of the pasted or generated draft text and out of text revisions. A category-only edit uses the existing PATCH (`initiativeId` + `categories`).
- Card dots are **8px**, **4px** apart and **8px** after the title, in stored order with the primary first, at most 3. The dot trigger is at least **24px** square.
- Board categories allow any number of selections. The forms allow **1 to 3**.
- Form option rows are **44px** high at ≤640px.
- Required copy, verbatim: **Find matches**, **AI matches**, **Filters (N)**, **Show N initiatives**, **Clear filters**, **Browse category**, **Use suggestions**, **Primary category**, **Category**, **Funding status**, **Sort**, "N initiatives", "N of M initiatives".
- Phone breakpoint: `max-[640px]` (the same as `usePhone`). Page width checks: 320, 390, 640, 768 and 1440px with no horizontal page scroll.
- Menus use the existing solid panel look (`bg-panel border-edge2 shadow-menu rounded-[14px]`, `z-[210]`). Controls are 40px high on desktop and 44px on phones, with `border-white/10` borders. A category colour only fills a dot, never a button.
- Commands (run from the repo root): web tests `deno task test` (vitest), API tests `deno task test:api`, `deno task typecheck`, `deno task lint`, `deno task fmt`, `deno task build`. A single web test file: `deno run -A npm:vitest run <path>`.
- Known unrelated failures, which must not be "fixed" here: `kv-depth` in the API tests; `rules.test` and `PasteBox` on CRLF checkouts.
- Commit messages follow the repo style (a sentence-style summary) and end with the `Co-Authored-By` line the harness gives.

## Review Focus

1. **A tampered or old autosave** holds unknown slugs, duplicates, more than 3 entries or a non-array. The restored draft keeps the valid, unique, ordered first 3 and never crashes (test in Task 1).
2. **A title with no spaces, trailing spaces or a very long last word (for example a URL)** at 320px. The last word truncates inside the group, the dots stay beside it and the page does not scroll sideways (unit test of `splitTitle` in Task 5, screenshot in Task 10).
3. **Two AI board searches in quick succession** where the first answer arrives last. The second query's order wins (test in Task 6).
4. **The board refetches (5 s cache) while the mobile sheet is open.** The provisional selection survives the new `cards` prop (test in Task 8).
5. **A legacy untagged initiative on the edit page.** The picker starts empty, the checks count categories as unanswered, and saving is blocked with the finding focused, as the old picker did (test in Task 2).

---

## File Structure

| File | Responsibility |
|---|---|
| `app/lib/categories.ts` (modify) | Re-export `isCategorySlug`; add `normaliseCategories`. |
| `app/components/initiative-form/types.ts` (modify) | `Draft.categories`, `SubmitPayload.categories`. |
| `app/components/initiative-form/useDraft.ts` (modify) | Empty draft, `fromInitiative`, `isEmptyDraft`, `toPayload`, the `setCategories` action. |
| `app/components/initiative-form/useAutosave.ts` (modify) | Revive `categories`, defaulting to `[]`. |
| `app/components/initiative-form/PreviewPane.tsx` (modify) | The preview uses `d.categories`. |
| `app/components/initiative-form/useChecks.ts` (modify) | The categories rule, the required count, the `categories` option. |
| `app/components/initiative-form/ChecksCard.tsx` (modify) | "Nothing blocks" only when everything required is answered. |
| `app/components/initiative-form/useCategorySuggestion.ts` (create) | Debounced AI suggestion, stale-safe and offer-only. |
| `app/components/ui/CategoryDot.tsx` (create) | The 8px dot. |
| `app/components/initiative-form/CategoriesPicker.tsx` (rewrite) | The Combobox picker with tokens, limit, primary select and suggestion row. |
| `app/components/initiative-form/CategoryField.tsx` (create) | Draft plus findings plus suggestion wiring for `InitiativeForm`. |
| `app/components/initiative-form/InitiativeForm.tsx` (modify) | Uses `CategoryField`; `categories` prop becomes `{ suggest?: boolean }`. |
| `app/routes/submit.tsx`, `app/routes/initiative.edit.tsx`, `app/lib/submit-initiative.ts` (modify) | Categories come from the draft. |
| `app/components/admin/initiative/CategoriesPanel.tsx` (modify) | New picker, no suggestion. |
| `app/lib/board-view.ts` (modify) | `CLEARED`, `activeFilterCount`, `resultLabel`, `STATUS_LABELS`. |
| `app/components/board/CardTitle.tsx` (create) | `splitTitle` and the title with its dot group kept together. |
| `app/components/board/CategoryDots.tsx` (create) | Tooltip, popover and the Browse category links. |
| `app/components/board/InitiativeCard.tsx` (modify) | Uses `CardTitle`; pills removed. |
| `app/components/board/AiSearch.tsx` (modify) | "Find matches", the explanation, `active` prop, stale guard. |
| `app/components/board/filters/TypeTabs.tsx` (create) | Underlined All / RFPs / Grants. |
| `app/components/board/filters/CategoryFilter.tsx` (create) | Searchable multi-select dropdown with counts. |
| `app/components/board/filters/SortSelect.tsx` (create) | Eight sorts plus "AI matches" while active. |
| `app/components/board/filters/StatusSelect.tsx` (create) | Funding status select. |
| `app/components/board/filters/ActiveFilters.tsx` (create) | Removable tokens and Clear filters. |
| `app/components/board/filters/FilterSheet.tsx` (create) | Mobile bottom sheet (Base UI Drawer) with a provisional state. |
| `app/components/board/FilterBar.tsx` (rewrite) | Lays the toolbar out for desktop, intermediate widths and phones. |
| `app/routes/board.tsx` (modify) | Wiring, AI/manual sort, plain group headings. |
| `app/components/ui/CategoryTag.tsx` (modify) | Remove the unused `CategoryChip`. |
| `app/app.css` (modify) | Remove the unused `.cat-on` / `.cat-dim` rules. |
| `public/llms.txt` (modify) | The category step in the guide. |

---

### Task 1: Categories live in the draft

**Files:**
- Modify: `app/lib/categories.ts`
- Modify: `app/components/initiative-form/types.ts`
- Modify: `app/components/initiative-form/useDraft.ts`
- Modify: `app/components/initiative-form/useAutosave.ts`
- Modify: `app/components/initiative-form/PreviewPane.tsx:40`
- Test: `app/components/initiative-form/useDraft.test.ts`, `app/components/initiative-form/useAutosave.test.ts`

**Interfaces:**
- Produces: `normaliseCategories(raw: readonly unknown[]): string[]` in `~/lib/categories`; `Draft.categories: string[]`; `SubmitPayload.categories: string[]`; reducer action `{ t: "setCategories"; value: string[] }`; `actions.setCategories(value: string[])`.

- [ ] **Step 1: Write the failing tests**

Append to `app/components/initiative-form/useDraft.test.ts`, inside `describe("useDraft reducer", …)`:

```ts
  it("keeps categories in the draft, ordered, unique, known and at most three", () => {
    const s = draftReducer(state(), {
      t: "setCategories",
      value: ["opsec", "defi", "opsec", "nope", "audits-analysis", "compilers"],
    });
    expect(s.draft.categories).toEqual(["opsec", "defi", "audits-analysis"]);
    expect(toPayload(s.draft).categories).toEqual(["opsec", "defi", "audits-analysis"]);
  });

  it("a paste replaces the text and leaves the categories alone", () => {
    let s = draftReducer(state(), { t: "setCategories", value: ["defi"] });
    s = draftReducer(s, { t: "replaceText", text: "## Title\nNew title\n" });
    expect(s.draft.page.title).toBe("New title");
    expect(s.draft.categories).toEqual(["defi"]);
  });

  it("a draft with only categories is not empty", () => {
    const d = emptyDraft();
    expect(d.categories).toEqual([]);
    expect(isEmptyDraft({ ...d, categories: ["defi"] })).toBe(false);
  });

  it("an initiative's categories seed the edit draft", () => {
    const d = fromInitiative({ ...structuredRow(), categories: ["opsec", "defi"] } as Initiative);
    expect(d.categories).toEqual(["opsec", "defi"]);
  });
```

(If `structuredRow` takes arguments or already sets `categories`, adjust the call. It is in `test/fixtures.ts`.)

Append to `app/components/initiative-form/useAutosave.test.ts`, importing `reviveDraft` and `snapshot` from `./useAutosave` and `emptyDraft` from `./useDraft` if they are not imported already:

```ts
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
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `deno run -A npm:vitest run app/components/initiative-form/useDraft.test.ts app/components/initiative-form/useAutosave.test.ts`
Expected: FAIL. `setCategories` is unknown and `categories` is undefined.

- [ ] **Step 3: Implement**

`app/lib/categories.ts`: add `isCategorySlug` to the re-export list and append:

```ts
/** A list from the client or storage: known slugs, first occurrence wins, at most three. */
export const normaliseCategories = (raw: readonly unknown[]): string[] =>
  [...new Set(raw.filter(isCategorySlug))].slice(0, MAX_CATEGORIES);
```

(Also import `isCategorySlug` and `MAX_CATEGORIES` from `@shared/categories` for local use.)

`types.ts`: add to `Draft`, after `topup`:

```ts
  /** 1 to 3 category slugs, the first is primary. Outside the pasted text and the revisions. */
  categories: string[];
```

Add `categories: string[];` to `SubmitPayload` after `topup`.

`useDraft.ts`:
- `emptyDraft()`: add `categories: [],` after `topup`.
- `fromInitiative`: `d.categories = normaliseCategories(r.categories ?? []);`
- `isEmptyDraft`: in the return, `return !(d.categories.length || page || …)`.
- `toPayload`: `categories: [...d.categories],` after `topup`.
- `DraftAction`: `| { t: "setCategories"; value: string[] }`.
- reducer: `case "setCategories": return { ...s, draft: { ...d, categories: normaliseCategories(a.value) } };`
- actions: `setCategories: (value: string[]) => dispatch({ t: "setCategories", value }),`
- import `normaliseCategories` from `~/lib/categories`.

`useAutosave.ts` `reviveDraft`: add
`categories: Array.isArray(s.categories) ? normaliseCategories(s.categories) : [],`

`PreviewPane.tsx`: `categories: d.categories,` in place of `categories: [],`.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `deno run -A npm:vitest run app/components/initiative-form/`
Expected: PASS. Fix any fixture that builds a `Draft` literal by adding `categories: []`. The compiler lists them in Step 5.

- [ ] **Step 5: Typecheck**

Run: `deno task typecheck`
Expected: clean. The routes still keep their own category state until Task 2, and `submitInitiative`'s `categories` option still overrides the payload's empty list.

- [ ] **Step 6: Commit**

```bash
git add app/lib/categories.ts app/components/initiative-form/
git commit -m "Categories in the form draft: autosaved, restored, previewed and posted with the payload, tampered or old drafts read as valid slugs or none"
```

---

### Task 2: Categories in the live checks

**Files:**
- Modify: `app/components/initiative-form/useChecks.ts`
- Modify: `app/components/initiative-form/ChecksCard.tsx:103-110`
- Modify: `app/components/initiative-form/InitiativeForm.tsx`
- Modify: `app/routes/submit.tsx`, `app/routes/initiative.edit.tsx`, `app/lib/submit-initiative.ts`
- Test: `app/components/initiative-form/InitiativeForm.checks.test.tsx`

**Interfaces:**
- Consumes: `Draft.categories` (Task 1).
- Produces: `runChecks(d, scope, opts?: { categories?: boolean })`; `requiredFields(d, scope, opts?)`; `useChecks(draft, { …, categories?: boolean })`; `CATEGORY_MISSING = "Pick at least one category."` exported from `useChecks.ts`; `InitiativeFormProps.categories?: { suggest?: boolean }`. The picker (Task 3) paints the field id `f-categories`.

- [ ] **Step 1: Write the failing tests**

Append to `InitiativeForm.checks.test.tsx`, reusing its `validDraft()`:

```tsx
describe("categories in the checks", () => {
  const withCats = (d: Draft) =>
    render(
      <InitiativeForm
        mode="submit"
        initial={d}
        onSubmit={vi.fn(async () => {})}
        submitLabel="Submit for review"
        autosaveKey={null}
        categories={{}}
      />,
    );

  it("counts categories as a required question", () => {
    withCats(validDraft());
    expect(screen.getByText(/required answered/).textContent).toMatch(/of 13 required/);
    // 12 before categories: title, summary, goal, duration, 6 RFP sections, milestones, funders, contact = 13 with categories
  });

  it("an empty category list blocks the submit, is listed, painted and focused", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <InitiativeForm
        mode="submit"
        initial={validDraft()}
        onSubmit={onSubmit}
        submitLabel="Submit for review"
        autosaveKey={null}
        categories={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing blocks this submission/)).toBeNull();
    expect(screen.getAllByText("Pick at least one category.").length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(document.activeElement?.id).toBe("f-categories"));
  });

  it("says nothing blocks only when every required question is answered", () => {
    const d = { ...validDraft(), categories: ["opsec"] };
    withCats(d);
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/ }));
    expect(screen.getByText(/Nothing blocks this submission/)).toBeInTheDocument();
  });

  it("a legacy untagged row on the edit page cannot save until one is picked", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <InitiativeForm
        mode="edit"
        initial={validDraft()}
        onSubmit={onSubmit}
        submitLabel="Save"
        categories={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(document.activeElement?.id).toBe("f-categories"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

Before writing it, check the existing count on a valid submit RFP draft by running the form once. If the base count is not 12, change the `13` to base + 1. The assertion is "one more than without `categories`".

- [ ] **Step 2: Run the tests and check that they fail**

Run: `deno run -A npm:vitest run app/components/initiative-form/InitiativeForm.checks.test.tsx`
Expected: FAIL on the count, the focus (`f-categories` does not exist yet) and the "Nothing blocks" text.

- [ ] **Step 3: Implement the checks**

`useChecks.ts`:

```ts
export const CATEGORY_MISSING = "Pick at least one category.";

type CheckOpts = { categories?: boolean };

export function requiredFields(d: Draft, scope: CheckScope, opts: CheckOpts = {}): string[] {
  const out: string[] = opts.categories ? ["categories", "title", "summary"] : ["title", "summary"];
  // …rest unchanged
}

export function runChecks(d: Draft, scope: CheckScope, opts: CheckOpts = {}): Findings {
  const r = checkSubmission(toCheckInput(d), scope);
  const cats: Finding[] = opts.categories && !d.categories.length
    ? [{ field: "categories", msg: CATEGORY_MISSING, kind: "missing" }]
    : [];
  return { errors: [...cats, ...r.errors, ...clientOnly(d)], warnings: r.warnings };
}
```

`useChecks(draft, { submitted, serverFindings, scope = "submit", categories = false })`: call `runChecks(draft, scope, { categories })` and `requiredFields(draft, scope, { categories })`, and add `categories` to the `useMemo` dependencies.

`ChecksCard.tsx`: the ok line becomes

```tsx
{submitted && required.answered === required.total
  ? "Nothing blocks this submission"
  : "Nothing is wrong with what is filled in so far"}
```

`InitiativeForm.tsx`:
- The prop type becomes `categories?: { suggest?: boolean };` with the doc comment updated: "Show and require the categories question (it lives in the draft). `suggest` offers an AI suggestion from the title and summary."
- `const withCats = Boolean(categories);`, then `useChecks(draft, { submitted, serverFindings: feedback?.findings, scope, categories: withCats })` and `runChecks(draft, scope, { categories: withCats })` in `submit`.
- Delete the `CATEGORY_MISSING` const, the `unshift` block and `categoryError`.
- For now, render `CategoriesPicker` with `value={draft.categories}` and `onChange={actions.setCategories}`, and pass `suggestFrom={categories.suggest ? draft.page : undefined}` as before. Task 3 swaps in `CategoryField`. To make the focus test pass before Task 3, change the old picker's wrapper to `id="f-categories"`. Task 3 moves that id onto the combobox input.

Routes, now that the draft owns the list:
- `app/lib/submit-initiative.ts`: remove the `categories` option and the `{ ...toPayload(draft, cids), categories }` spread, going back to `json: toPayload(draft, cids)`.
- `submit.tsx`: remove `const [categories, setCategories] = useState<string[]>([]);`, call `submitInitiative(draft)`, and pass `categories={{ suggest: true }}`. Drop `useState` from the import if nothing else uses it.
- `initiative.edit.tsx`: remove the `categories` state. In `onSubmit`, use `const cats = payload.categories.join() !== r.categories.join() ? { categories: payload.categories } : null;`. Pass `categories={{}}`. The initial draft already carries `r.categories` from `fromInitiative`.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `deno run -A npm:vitest run app/components/initiative-form/`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `deno task typecheck && deno run -A npm:vitest run app/routes/`
Expected: clean and PASS. Fix any route test that relied on the old route-level state.

```bash
git add app/components/initiative-form/ app/lib/submit-initiative.ts app/routes/
git commit -m "Checks: categories count as a required question, a missing one is a finding that paints and focuses the field, and Nothing blocks shows only when everything required is answered"
```

---

### Task 3: AI suggestion hook and the Combobox picker in every form

**Files:**
- Create: `app/components/ui/CategoryDot.tsx`
- Create: `app/components/initiative-form/useCategorySuggestion.ts`
- Rewrite: `app/components/initiative-form/CategoriesPicker.tsx`
- Create: `app/components/initiative-form/CategoryField.tsx`
- Modify: `app/components/initiative-form/InitiativeForm.tsx`, `app/components/admin/initiative/CategoriesPanel.tsx`
- Test: `app/components/initiative-form/useCategorySuggestion.test.ts`, `app/components/initiative-form/CategoriesPicker.test.tsx`

**Interfaces:**
- Consumes: `Draft.categories`, `actions.setCategories`, `normaliseCategories` (Task 1); `CATEGORY_MISSING` and the `f-categories` id convention (Task 2); `useFinding` from `./findings`.
- Produces:
  - `CategoryDot({ slug, className? })`: an 8px `aria-hidden` span coloured `categoryOf(slug).base`.
  - `useCategorySuggestion({ title, summary, enabled }): string[] | null`.
  - `CategoriesPicker({ value, onChange, suggestion?, onUseSuggestion?, id?, label?, invalid?, disabled?, message? })`.
  - `CategoryField({ draft, actions, suggest })`.

- [ ] **Step 1: Write the failing hook tests**

`app/components/initiative-form/useCategorySuggestion.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCategorySuggestion } from "./useCategorySuggestion";

const api = vi.fn();
vi.mock("~/lib/api", async (original) => ({
  ...(await original<typeof import("~/lib/api")>()),
  api: (...a: unknown[]) => api(...a),
}));

const TITLE = "Fuzzing for rollup bridges";
const SUMMARY = "A fuzzer that finds bugs in rollup bridge contracts.";

beforeEach(() => {
  vi.useFakeTimers();
  api.mockReset();
});
afterEach(() => vi.useRealTimers());

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

it("offers a suggestion after the pause, never before", async () => {
  api.mockResolvedValue({ categories: ["fuzzing-testing", "nope", "defi"] });
  const { result } = renderHook(() =>
    useCategorySuggestion({ title: TITLE, summary: SUMMARY, enabled: true })
  );
  expect(result.current).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(result.current).toEqual(["fuzzing-testing", "defi"]);
});

it("ignores a stale response once the text changed", async () => {
  const first = deferred<{ categories: string[] }>();
  api.mockReturnValueOnce(first.promise).mockResolvedValue({ categories: ["opsec"] });
  const { result, rerender } = renderHook((p) => useCategorySuggestion(p), {
    initialProps: { title: TITLE, summary: SUMMARY, enabled: true },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  rerender({ title: TITLE + " v2", summary: SUMMARY, enabled: true });
  await act(async () => {
    first.resolve({ categories: ["defi"] });
  });
  expect(result.current).toBeNull(); // the old answer never shows for the new text
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(result.current).toEqual(["opsec"]);
});

it("a change to the source text withdraws a shown suggestion", async () => {
  api.mockResolvedValue({ categories: ["defi"] });
  const { result, rerender } = renderHook((p) => useCategorySuggestion(p), {
    initialProps: { title: TITLE, summary: SUMMARY, enabled: true },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(result.current).toEqual(["defi"]);
  rerender({ title: TITLE, summary: SUMMARY + " More.", enabled: true });
  expect(result.current).toBeNull();
});

it("asks nothing while disabled or while the text is short", async () => {
  renderHook(() => useCategorySuggestion({ title: TITLE, summary: SUMMARY, enabled: false }));
  renderHook(() => useCategorySuggestion({ title: "Short", summary: SUMMARY, enabled: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(api).not.toHaveBeenCalled();
});

it("does not ask twice for the same text", async () => {
  api.mockResolvedValue({ categories: ["defi"] });
  const { rerender } = renderHook((p) => useCategorySuggestion(p), {
    initialProps: { title: TITLE, summary: SUMMARY, enabled: true },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  rerender({ title: TITLE, summary: SUMMARY, enabled: false });
  rerender({ title: TITLE, summary: SUMMARY, enabled: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(api).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run them and check that they fail**

Run: `deno run -A npm:vitest run app/components/initiative-form/useCategorySuggestion.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement the hook**

`app/components/initiative-form/useCategorySuggestion.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import { api } from "~/lib/api";
import { normaliseCategories } from "~/lib/categories";

const PAUSE = 1200;

/**
 * The AI's categories for a title and summary, offered and never applied: the
 * form shows them with "Use suggestions". An answer counts only for the exact
 * text it was asked about, so a response that arrives after an edit is dropped,
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
```

A failed request is cached as `[]` for that text, so it is not retried on every keystroke-free rerender. It is retried once the text changes.

- [ ] **Step 4: Run the hook tests and check that they pass**

Run: `deno run -A npm:vitest run app/components/initiative-form/useCategorySuggestion.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing picker tests**

First read the "Multiple select" and "Input inside popup" sections of `node_modules/@base-ui/react/docs/react/components/combobox.md` (from line 1197), and the `Select.test.tsx` note that Base UI ignores a click that lands the instant a list opens. Drive the tests with the keyboard.

`app/components/initiative-form/CategoriesPicker.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import CategoriesPicker from "./CategoriesPicker";

function Harness(
  { start = [] as string[], suggestion = null as string[] | null, onChange = vi.fn() } = {},
) {
  const [value, setValue] = useState(start);
  return (
    <CategoriesPicker
      id="f-categories"
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
      suggestion={suggestion}
    />
  );
}

const input = () => screen.getByRole("combobox", { name: /Categories/ });
const open = () => {
  input().focus();
  fireEvent.keyDown(input(), { key: "ArrowDown" });
};

it("picks several with the keyboard, keeping the list open, in the order picked", async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  open();
  fireEvent.change(input(), { target: { value: "ops" } });
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith(["opsec"]);
  fireEvent.change(input(), { target: { value: "defi" } });
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith(["opsec", "defi"]);
  expect(await screen.findByRole("listbox")).toBeInTheDocument();
});

it("shows neutral removable tokens, and removing one keeps the others' order", () => {
  const onChange = vi.fn();
  render(<Harness start={["opsec", "defi", "compilers"]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove DeFi Safety" }));
  expect(onChange).toHaveBeenLastCalledWith(["opsec", "compilers"]);
});

it("at three, disables the other options, keeps the picked ones removable, and says why", async () => {
  render(<Harness start={["opsec", "defi", "compilers"]} />);
  expect(screen.getByText(/You can pick up to 3/)).toBeInTheDocument();
  open();
  const list = await screen.findByRole("listbox");
  expect(within(list).getByRole("option", { name: /Formal Verification/ }))
    .toHaveAttribute("aria-disabled", "true");
  expect(within(list).getByRole("option", { name: /OpSec/ })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

it("a Primary category select appears with two or more and reorders them", async () => {
  const onChange = vi.fn();
  render(<Harness start={["opsec", "defi"]} onChange={onChange} />);
  const primary = screen.getByRole("combobox", { name: "Primary category" });
  expect(primary).toHaveTextContent("OpSec");
  primary.focus();
  fireEvent.keyDown(primary, { key: "ArrowDown" });
  const opt = await screen.findByRole("option", { name: "DeFi Safety" });
  fireEvent.click(opt);
  expect(onChange).toHaveBeenLastCalledWith(["defi", "opsec"]);
});

it("no Primary category select with one", () => {
  render(<Harness start={["opsec"]} />);
  expect(screen.queryByRole("combobox", { name: "Primary category" })).toBeNull();
});

it("offers a suggestion only on an empty field, applied only on Use suggestions", () => {
  const onChange = vi.fn();
  const { unmount } = render(<Harness suggestion={["defi", "opsec"]} onChange={onChange} />);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use suggestions" }));
  expect(onChange).toHaveBeenLastCalledWith(["defi", "opsec"]);
  unmount();
  render(<Harness start={["compilers"]} suggestion={["defi"]} />);
  expect(screen.queryByRole("button", { name: "Use suggestions" })).toBeNull();
});
```

If Base UI's disabled item exposes `data-disabled` rather than `aria-disabled` in jsdom, assert on whichever the rendered DOM shows, and note it in the test's comment. What matters is that Enter on it changes nothing. Add `fireEvent.keyDown(Enter)` on a highlighted disabled option and expect `onChange` not to be called.

- [ ] **Step 6: Run them and check that they fail**

Run: `deno run -A npm:vitest run app/components/initiative-form/CategoriesPicker.test.tsx`
Expected: FAIL. The old chip picker has no combobox.

- [ ] **Step 7: Implement `CategoryDot` and the picker**

`app/components/ui/CategoryDot.tsx`:

```tsx
import { categoryOf } from "~/lib/categories";
import { cn } from "~/lib/utils";

/** A category's colour as an 8px dot; unknown slugs render nothing. */
export default function CategoryDot({ slug, className }: { slug: string; className?: string }) {
  const c = categoryOf(slug);
  if (!c) return null;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 flex-none rounded-full", className)}
      style={{ background: c.base }}
    />
  );
}
```

`app/components/initiative-form/CategoriesPicker.tsx` (full rewrite):

```tsx
import { Combobox } from "@base-ui/react/combobox";
import { Check, X } from "lucide-react";
import { useId } from "react";
import CategoryDot from "~/components/ui/CategoryDot";
import { Button } from "~/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import { CATEGORIES, categoryOf, MAX_CATEGORIES } from "~/lib/categories";
import { cn } from "~/lib/utils";

const SLUGS = CATEGORIES.map((c) => c.slug as string);
const label = (s: string) => categoryOf(s)?.label ?? s;

/** Keep the existing order; anything new goes last. */
const keepOrder = (was: string[], next: string[]) => [
  ...was.filter((s) => next.includes(s)),
  ...next.filter((s) => !was.includes(s)),
];

/**
 * 1 to 3 categories in one searchable field: the picked ones are removable
 * tokens inside it, the first is primary (a Primary category select appears
 * with two or more). At three the other options are disabled. An AI
 * suggestion, when given and the field is empty, is offered, never applied.
 */
export default function CategoriesPicker({
  value,
  onChange,
  suggestion,
  id,
  label: title = "Categories",
  invalid,
  disabled,
  message,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestion?: string[] | null;
  id?: string;
  label?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Under the field (the findings), in place of nothing. */
  message?: React.ReactNode;
}) {
  const labelId = useId();
  const hintId = useId();
  const full = value.length >= MAX_CATEGORIES;
  return (
    <div className="mt-4" data-field="categories">
      <span className="label" id={labelId}>{title} *</span>
      <p className="hint m-0 mb-2" id={hintId}>
        Pick 1 to 3. The first one is the primary category.
      </p>
      <Combobox.Root
        items={SLUGS}
        multiple
        value={value}
        disabled={disabled}
        itemToStringLabel={label}
        onValueChange={(next: string[]) =>
          onChange(keepOrder(value, next).slice(0, MAX_CATEGORIES))}
        onOpenChange={(open, details) => {
          // keep the list open for the next pick
          if (!open && details.reason === "item-press") details.cancel();
        }}
      >
        <Combobox.Chips
          className={cn(
            "field flex min-h-[44px] w-full flex-wrap items-center gap-1.5 py-1.5 focus-within:border-[rgba(92,183,90,.6)]",
            invalid && "has-error",
          )}
        >
          <Combobox.Value>
            {(picked: string[]) => (
              <>
                {picked.map((s) => (
                  <Combobox.Chip
                    key={s}
                    aria-description="Press Backspace or Delete to remove"
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-white/[.06] pl-2.5 pr-1 font-inter-tight text-[13px] text-white outline-none data-[highlighted]:border-white/30"
                  >
                    <CategoryDot slug={s} />
                    {label(s)}
                    <Combobox.ChipRemove
                      aria-label={`Remove ${label(s)}`}
                      className="grid size-5 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </Combobox.ChipRemove>
                  </Combobox.Chip>
                ))}
                <Combobox.Input
                  id={id}
                  aria-labelledby={labelId}
                  aria-describedby={hintId}
                  aria-invalid={invalid || undefined}
                  placeholder={picked.length ? "" : "Search categories"}
                  className="min-w-[8ch] flex-1 border-0 bg-transparent p-0 text-[14px] text-white outline-none placeholder:text-white/30"
                />
              </>
            )}
          </Combobox.Value>
        </Combobox.Chips>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={6} className="z-[210] w-(--anchor-width)">
            <Combobox.Popup className="max-h-[min(var(--available-height),320px)] overflow-y-auto overscroll-contain rounded-[14px] border border-edge2 bg-panel p-1.5 shadow-menu outline-none">
              <Combobox.Empty className="px-3 py-2.5 small dim">No category matches.</Combobox.Empty>
              <Combobox.List>
                {(s: string) => (
                  <Combobox.Item
                    key={s}
                    value={s}
                    disabled={full && !value.includes(s)}
                    className="flex min-h-[40px] cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-3 font-inter-tight text-[14px] text-soft outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-white/[.06] data-[highlighted]:text-white max-[640px]:min-h-[44px]"
                  >
                    <CategoryDot slug={s} />
                    <span className="flex-1">{label(s)}</span>
                    <Combobox.ItemIndicator>
                      <Check className="size-4 text-dao-green" aria-hidden="true" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {full && (
        <p className="m-0 mt-1.5 small dim" aria-live="polite">
          You can pick up to 3. Remove one to choose another.
        </p>
      )}
      {!value.length && suggestion?.length && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 small dim">
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            Suggested:
            {suggestion.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-white/80">
                <CategoryDot slug={s} />
                {label(s)}
              </span>
            ))}
          </span>
          <Button sm variant="ghost" onClick={() => onChange(suggestion)}>Use suggestions</Button>
        </div>
      )}
      {value.length > 1 && (
        <div className="mt-2.5 flex items-center gap-2.5 small dim">
          <span id={`${labelId}-primary`}>Primary category</span>
          <Select
            value={value[0]}
            items={value.map((s) => ({ value: s, label: label(s) }))}
            disabled={disabled}
            onValueChange={(v) => onChange([v as string, ...value.filter((s) => s !== v)])}
          >
            <SelectTrigger size="sm" aria-label="Primary category" className="min-h-[36px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {value.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {message}
    </div>
  );
}
```

Notes for the implementer:
- Check the Combobox `onValueChange` and `onOpenChange` signatures and `details.reason === "item-press"` against the local docs "Keeping the filter after selection" section. With the input outside the popup, cancel the `item-press` close.
- If the `Combobox.Value` render function does not type its argument, cast it (`(picked: string[])`).
- `Combobox.Chips` is the visible field. The `field` class gives it the site input look; `has-error` paints it like the other fields.

`app/components/initiative-form/CategoryField.tsx`:

```tsx
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
```

The suggestion is keyed by the draft's own title and summary. A restore, a Discard or a wallet switch replaces the draft, so the text changes and a shown suggestion goes away. Nothing is ever written into the draft without a click.

`InitiativeForm.tsx`: replace the `CategoriesPicker` block with

```tsx
{categories && <CategoryField draft={draft} actions={actions} suggest={categories.suggest} />}
```

and update the import.

`CategoriesPanel.tsx`: replace `<CategoriesPicker label="Tags" value={value} onChange={setValue} />` with `<CategoriesPicker label="Tags" id="admin-categories" value={value} onChange={setValue} />`. The panel keeps its own state, Save button and approval gate unchanged.

- [ ] **Step 8: Run the tests**

Run: `deno run -A npm:vitest run app/components/initiative-form/ app/routes/initiative.edit.test.tsx app/routes/admin.initiative.test.tsx app/routes/submitted.test.tsx`
Expected: PASS. If an edit or admin test clicked an old category chip (`aria-pressed`), rewrite it to open the combobox with ArrowDown and pick the option with Enter, as in the picker tests.

- [ ] **Step 9: Add the edit round-trip test**

Append to `app/routes/initiative.edit.test.tsx`, following its existing render helper and api mock:

```tsx
it("a category-only change PATCHes categories and posts no revision", async () => {
  // render the edit page for an approved row with categories ["opsec"] (existing helper),
  // add "defi" through the combobox, press Save, then:
  // expect(api).toHaveBeenCalledWith(path, { method: "PATCH", json: { categories: ["opsec", "defi"], initiativeId: row.id } });
  // expect no call to the revision endpoint.
});
```

Write the body with the helpers already in that file: read its top 80 lines for the render and api mock names. Assert the exact PATCH body and that no POST to the revision endpoint happened.

- [ ] **Step 10: Typecheck, lint and commit**

Run: `deno task typecheck && deno task lint`
Expected: clean.

```bash
git add app/components/ui/CategoryDot.tsx app/components/initiative-form/ app/routes/initiative.edit.test.tsx app/components/admin/initiative/CategoriesPanel.tsx
git commit -m "Category picker: one searchable Base UI combobox with removable tokens, a three-category limit, a Primary category select and AI suggestions offered with Use suggestions, never applied, dropped when their text changes, in submit, edit and admin"
```

---

### Task 4: Board view helpers

**Files:**
- Modify: `app/lib/board-view.ts`
- Test: `app/lib/board-view.test.ts`

**Interfaces:**
- Produces: `CLEARED: Pick<BoardView, "cats" | "status" | "q">`; `activeFilterCount(v: BoardView): number`; `resultLabel(shown: number, total: number, filtered: boolean): string`; `STATUS_LABELS: Record<Exclude<BoardStatus, "all">, string>`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("board view", …)` in `app/lib/board-view.test.ts`:

```ts
  it("Clear filters empties categories, funding status and the keyword, keeping type, sort and view", () => {
    const v = { ...DEFAULT_VIEW, type: "rfp", cats: ["opsec"], status: "open", sort: "newest", q: "x" } as BoardView;
    expect({ ...v, ...CLEARED }).toEqual({ ...v, cats: [], status: "all", q: "" });
  });

  it("counts the active filters the Filters button shows", () => {
    expect(activeFilterCount(DEFAULT_VIEW)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_VIEW, cats: ["a", "b"], status: "funded" })).toBe(3);
    expect(activeFilterCount({ ...DEFAULT_VIEW, type: "rfp", sort: "newest" })).toBe(0);
  });

  it("labels the results", () => {
    expect(resultLabel(12, 12, false)).toBe("12 initiatives");
    expect(resultLabel(1, 1, false)).toBe("1 initiative");
    expect(resultLabel(3, 12, true)).toBe("3 of 12 initiatives");
    expect(resultLabel(1, 1, true)).toBe("1 of 1 initiative");
  });
```

Add `CLEARED`, `activeFilterCount`, `resultLabel`, `DEFAULT_VIEW` and `type BoardView` to the imports.

- [ ] **Step 2: Run the tests and check that they fail**

Run: `deno run -A npm:vitest run app/lib/board-view.test.ts`
Expected: FAIL, because the exports are missing.

- [ ] **Step 3: Implement**

Append to `app/lib/board-view.ts`:

```ts
import { plural } from "~/lib/format";

export const STATUS_LABELS = { open: "Open for funding", funded: "Fully funded" } as const;

/** What Clear filters resets: the narrowing filters. Type, sort, view and the
 * AI order stay as they are. */
export const CLEARED = { cats: [] as string[], status: "all", q: "" } as const satisfies Partial<
  BoardView
>;

/** The number the Filters (N) button shows: categories plus a funding restriction. */
export const activeFilterCount = (v: BoardView): number =>
  v.cats.length + (v.status !== "all" ? 1 : 0);

/** "12 initiatives", or "3 of 12 initiatives" while filters narrow the board. */
export const resultLabel = (shown: number, total: number, filtered: boolean): string =>
  filtered ? `${shown} of ${plural(total, "initiative")}` : plural(total, "initiative");
```

(Put the import with the others at the top.) If `satisfies` with the `as const` array trips the type of `cats`, declare `export const CLEARED: Pick<BoardView, "cats" | "status" | "q"> = { cats: [], status: "all", q: "" };`.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `deno run -A npm:vitest run app/lib/board-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/board-view.ts app/lib/board-view.test.ts
git commit -m "Board view: what Clear filters resets, the active filter count and the result label"
```

---

### Task 5: Card titles with category dots

**Files:**
- Create: `app/components/board/CardTitle.tsx`
- Create: `app/components/board/CategoryDots.tsx`
- Modify: `app/components/board/InitiativeCard.tsx`
- Test: `app/components/board/CardTitle.test.tsx`, `app/components/board/InitiativeCard.test.tsx`

**Interfaces:**
- Consumes: `CategoryDot` (Task 3).
- Produces: `splitTitle(title: string): [prefix: string, last: string]`; `CardTitle({ title, href, categories, onPrefetch })`; `CategoryDots({ slugs })`.

- [ ] **Step 1: Write the failing tests**

`app/components/board/CardTitle.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import CardTitle, { splitTitle } from "./CardTitle";

describe("splitTitle", () => {
  it("splits off the last word", () => {
    expect(splitTitle("Audit tooling for rollups")).toEqual(["Audit tooling for ", "rollups"]);
  });
  it("a one-word title has no prefix", () => {
    expect(splitTitle("Solidity")).toEqual(["", "Solidity"]);
  });
  it("ignores surrounding and repeated whitespace", () => {
    expect(splitTitle("  A   long  title  ")).toEqual(["A   long ", "title"]);
  });
  it("keeps a long URL-like last word whole", () => {
    const url = "https://example.org/" + "a".repeat(80);
    expect(splitTitle(`See ${url}`)).toEqual(["See ", url]);
  });
});

const view = (title: string, categories: string[]) =>
  render(
    <MemoryRouter>
      <CardTitle title={title} href="/initiative/x" categories={categories} />
    </MemoryRouter>,
  );

describe("CardTitle", () => {
  it("has one keyboard title link named with the full title", () => {
    view("Audit tooling for rollups", ["opsec"]);
    const links = screen.getAllByRole("link", { name: "Audit tooling for rollups" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/initiative/x");
    expect(links[0]).not.toHaveAttribute("tabindex", "-1");
  });

  it("a one-word title is one link with the full name", () => {
    view("Solidity", ["opsec"]);
    expect(screen.getAllByRole("link", { name: "Solidity" })).toHaveLength(1);
  });

  it("draws no dot trigger and no gap for an untagged card", () => {
    const { container } = view("Audit tooling", []);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-dots]")).toBeNull();
  });

  it("draws at most three dots in stored order, as one labelled button", () => {
    const { container } = view("T", ["defi", "opsec", "compilers", "sigma"]);
    const btn = screen.getByRole("button", {
      name: "Categories: DeFi Safety, OpSec, Compilers & Languages",
    });
    const dots = btn.querySelectorAll("span[aria-hidden]");
    expect(dots).toHaveLength(3);
    expect((dots[0] as HTMLElement).style.background).toBeTruthy();
    expect(container.querySelector("[data-dots]")).not.toBeNull();
  });

  it("a click opens a popover with Browse category links, and Escape returns focus", async () => {
    view("Audit tooling", ["opsec", "defi"]);
    const btn = screen.getByRole("button", { name: /Categories:/ });
    btn.focus();
    fireEvent.click(btn);
    const browse = await screen.findByRole("link", { name: "Browse category: OpSec" });
    expect(browse).toHaveAttribute("href", "/?cat=opsec");
    expect(screen.getByRole("link", { name: "Browse category: DeFi Safety" }))
      .toHaveAttribute("href", "/?cat=defi");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("link", { name: /Browse category/ })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });
});
```

In `InitiativeCard.test.tsx`, add:

```tsx
it("shows dots, not category pills, on a tagged card", () => {
  render(
    <MemoryRouter>
      <InitiativeCard
        card={card({ initiative: { ...card({}).initiative, categories: ["opsec"] } })}
        tokensOk={false}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "Categories: OpSec" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /OpSec/ })).toBeNull();
});
```

(Match the file's existing `card(…)` helper and render wrapper.)

- [ ] **Step 2: Run the tests and check that they fail**

Run: `deno run -A npm:vitest run app/components/board/`
Expected: FAIL, because `CardTitle` does not exist.

- [ ] **Step 3: Implement**

`app/components/board/CategoryDots.tsx`:

```tsx
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { useState } from "react";
import { Link } from "react-router";
import CategoryDot from "~/components/ui/CategoryDot";
import { type Category, categoryOf, MAX_CATEGORIES } from "~/lib/categories";

const PANEL = "rounded-[14px] border border-edge2 bg-panel shadow-menu outline-none";

/**
 * A card's categories as up to three dots: one button (24px target). Hover or
 * focus names them; a click opens a popover that stays until dismissed, with a
 * Browse category link for each. Tapping the dots never navigates.
 */
export default function CategoryDots({ slugs }: { slugs: string[] }) {
  const [open, setOpen] = useState(false);
  const cats = slugs.slice(0, MAX_CATEGORIES).map((s) => categoryOf(s)).filter(
    (c): c is Category => Boolean(c),
  );
  if (!cats.length) return null;
  const names = cats.map((c) => c.label).join(", ");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Root disabled={open}>
        <Tooltip.Trigger
          render={
            <Popover.Trigger
              aria-label={`Categories: ${names}`}
              className="inline-flex h-6 min-w-6 flex-none cursor-pointer items-center justify-center gap-1 rounded-md border-0 bg-transparent px-1 align-middle hover:bg-white/[.06] focus-visible:outline-2 focus-visible:outline-dao-bright data-[popup-open]:bg-white/[.08]"
            />
          }
        >
          {cats.map((c) => <CategoryDot key={c.slug} slug={c.slug} />)}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={6} className="z-[210]">
            <Tooltip.Popup className={`${PANEL} px-2.5 py-1.5 font-inter-tight text-[12px] text-white`}>
              {names}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-[210]">
          <Popover.Popup className={`${PANEL} w-[min(280px,calc(100vw-32px))] p-1.5`}>
            <Popover.Title className="sr-only">Categories</Popover.Title>
            <ul className="m-0 flex list-none flex-col p-0">
              {cats.map((c) => (
                <li
                  key={c.slug}
                  className="flex min-h-[40px] items-center gap-2.5 rounded-[9px] px-2.5"
                >
                  <CategoryDot slug={c.slug} />
                  <span className="flex-1 font-inter-tight text-[13.5px] text-white">
                    {c.label}
                  </span>
                  <Link
                    to={`/?cat=${c.slug}`}
                    aria-label={`Browse category: ${c.label}`}
                    className="small text-dao-green"
                    onClick={() => setOpen(false)}
                  >
                    Browse category
                  </Link>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

Check against `node_modules/@base-ui/react/docs/react/components/tooltip.md` and `popover.md` that `Tooltip.Trigger`'s `render` accepts a `Popover.Trigger` element (the "Composition" handbook, `docs/react/handbook/composition.md`). Also check that `Popover.Title` exists. If it does not, use `aria-label="Categories"` on the popup.

`app/components/board/CardTitle.tsx`:

```tsx
import { Link } from "react-router";
import CategoryDots from "./CategoryDots";

/** "Audit tooling for rollups" -> ["Audit tooling for ", "rollups"]; one word -> ["", word]. */
export function splitTitle(title: string): [string, string] {
  const t = title.trim();
  const i = t.search(/\s+\S+$/);
  if (i < 0) return ["", t];
  const last = t.slice(i).trimStart();
  return [t.slice(0, t.length - last.length), last];
}

const LINK =
  "text-white no-underline hover:no-underline group-has-[a:hover]/title:text-dao-green";

/**
 * The card title with its category dots. The last word and the dots sit in one
 * no-wrap group, so they move to the next line together and the dots never sit
 * on a line alone; a last word too long for the line truncates inside it. Two
 * links, one destination: the first is the keyboard stop and carries the full
 * title as its name, the last word's link is for the mouse only.
 */
export default function CardTitle({
  title,
  href,
  categories,
  onPrefetch,
}: {
  title: string;
  href: string;
  categories: string[];
  onPrefetch?: () => void;
}) {
  const [prefix, last] = splitTitle(title);
  const hasDots = categories.length > 0;
  const common = { to: href, prefetch: "intent" as const, onMouseEnter: onPrefetch, title };
  return (
    <h3 className="group/title m-0 pr-[72px] font-inter-tight text-[16px] font-medium leading-[1.35]">
      {prefix && (
        <Link {...common} onFocus={onPrefetch} aria-label={title} className={LINK}>
          {prefix}
        </Link>
      )}
      <span
        className="inline-flex max-w-full items-center gap-1 whitespace-nowrap align-bottom"
        data-dots={hasDots ? "" : undefined}
      >
        <Link
          {...common}
          tabIndex={prefix ? -1 : undefined}
          aria-hidden={prefix ? true : undefined}
          aria-label={prefix ? undefined : title}
          onFocus={prefix ? undefined : onPrefetch}
          className={`${LINK} min-w-0 truncate`}
        >
          {last}
        </Link>
        {hasDots && <CategoryDots slugs={categories} />}
      </span>
    </h3>
  );
}
```

Notes:
- `prefix` keeps its trailing whitespace, and the no-wrap group starts after it. That gives the only break opportunity before the last word.
- The group's `gap-1` (4px) plus the trigger's `px-1` (4px) puts the first dot 8px after the word. `CategoryDots` uses `gap-1` for the 4px between dots, and its padding keeps the 24px target.
- If the existing card title is not an `h3` in the page outline, use a `div` with the same classes. Check the card's heading usage with `grep -n "<h" app/components/board/InitiativeCard.tsx` first.

`InitiativeCard.tsx`: replace the title `<Link>` block and the `r.categories.length > 0 && (…)` pills block with

```tsx
<CardTitle
  title={r.title}
  href={`/initiative/${r.slug}`}
  categories={r.categories}
  onPrefetch={prefetch}
/>
```

Remove the `CategoryLink` import.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `deno run -A npm:vitest run app/components/board/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/board/CardTitle.tsx app/components/board/CategoryDots.tsx app/components/board/CardTitle.test.tsx app/components/board/InitiativeCard.tsx app/components/board/InitiativeCard.test.tsx
git commit -m "Cards: up to three 8px category dots after the title, kept on a line with the last word, named on hover or focus, a popover with Browse category links on click, one title link for the keyboard"
```

---

### Task 6: AI matching and the sort control

**Files:**
- Modify: `app/components/board/AiSearch.tsx`
- Create: `app/components/board/filters/SortSelect.tsx`
- Test: `app/components/board/AiSearch.test.tsx`, `app/components/board/filters/SortSelect.test.tsx`

**Interfaces:**
- Produces: `AiSearch({ active: boolean, onMatches: (ids: string[] | null) => void })`; `SortSelect({ sort: BoardSort, ai: boolean, onSort: (s: BoardSort) => void, className? })`.

- [ ] **Step 1: Write the failing tests**

`app/components/board/AiSearch.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("is labelled Find matches and explains that relevant initiatives move first", () => {
  render(<AiSearch active={false} onMatches={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Find matches" })).toBeInTheDocument();
  expect(screen.getByText(/Relevant initiatives move first/)).toBeInTheDocument();
});

it("the later of two searches wins even when the first answers last", async () => {
  let first!: (v: { matches: string[] }) => void;
  api.mockReturnValueOnce(new Promise((r) => (first = r)))
    .mockResolvedValueOnce({ matches: ["b"] });
  const onMatches = vi.fn();
  render(<AiSearch active={false} onMatches={onMatches} />);
  type("fuzzing tools");
  fireEvent.submit(screen.getByRole("button", { name: "Find matches" }).closest("form")!);
  type("wallet security");
  fireEvent.submit(screen.getByRole("button", { name: "Find matches" }).closest("form")!);
  await waitFor(() => expect(onMatches).toHaveBeenLastCalledWith(["b"]));
  await act(async () => first({ matches: ["a"] }));
  expect(onMatches).toHaveBeenLastCalledWith(["b"]);
  expect(onMatches).not.toHaveBeenCalledWith(["a"]);
});

it("drops its note when the board clears the AI order", async () => {
  api.mockResolvedValue({ matches: ["a"] });
  const { rerender } = render(<AiSearch active={false} onMatches={vi.fn()} />);
  type("fuzzing tools");
  fireEvent.submit(screen.getByRole("button", { name: "Find matches" }).closest("form")!);
  rerender(<AiSearch active onMatches={vi.fn()} />);
  expect(await screen.findByText(/moved to the front/)).toBeInTheDocument();
  rerender(<AiSearch active={false} onMatches={vi.fn()} />);
  expect(screen.queryByText(/moved to the front/)).toBeNull();
});
```

`app/components/board/filters/SortSelect.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SortSelect from "./SortSelect";

const openSort = () => {
  const t = screen.getByRole("combobox", { name: "Sort" });
  t.focus();
  fireEvent.keyDown(t, { key: "ArrowDown" });
};

it("offers the eight sorts", async () => {
  render(<SortSelect sort="recommended" ai={false} onSort={vi.fn()} />);
  openSort();
  expect(await screen.findAllByRole("option")).toHaveLength(8);
});

it("shows AI matches while the AI order is on, and a manual pick reports it", async () => {
  const onSort = vi.fn();
  render(<SortSelect sort="newest" ai onSort={onSort} />);
  expect(screen.getByRole("combobox", { name: "Sort" })).toHaveTextContent("AI matches");
  openSort();
  fireEvent.click(await screen.findByRole("option", { name: "Newest" }));
  expect(onSort).toHaveBeenCalledWith("newest");
});
```

- [ ] **Step 2: Run them and check that they fail**

Run: `deno run -A npm:vitest run app/components/board/AiSearch.test.tsx app/components/board/filters/SortSelect.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`AiSearch.tsx` changes:
- Signature: `({ active, onMatches }: { active: boolean; onMatches: (ids: string[] | null) => void })`.
- `const seq = useRef(0);`. In `run`: `const mine = ++seq.current;` after the length check. After the `await`, `if (mine !== seq.current) return;` before `onMatches` and `setNote`. In `catch`: `if (mine !== seq.current) return;`. In `finally`: `if (mine === seq.current) setBusy(false);`.
- The button's `aria-label` and visible text become `Find matches`.
- Below the form, when there is no `note`, show `<p id={hintId} className="-mt-2 mb-[18px] small dim">Relevant initiatives move first. Filters still apply.</p>`, and link it with `aria-describedby={hintId}` on the input.
- The note after results: `Relevant initiatives moved to the front.` plus the existing "Show the default order" button. Keep the text "moved to the front" for the test.
- External clear: `const was = useRef(active); useEffect(() => { if (was.current && !active && !failed) setNote(null); was.current = active; }, [active]);`

`app/components/board/filters/SortSelect.tsx`:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import { type BoardSort, SORTS } from "~/lib/board-view";
import { cn } from "~/lib/utils";

const ITEMS = SORTS.map(([value, label]) => ({ value: value as string, label: label as string }));
const AI = { value: "ai", label: "AI matches" };

/** The eight sorts; while the AI order is on it reads "AI matches", and any
 * manual pick (even the current one) hands the order back to the sort. */
export default function SortSelect(
  { sort, ai, onSort, className }: {
    sort: BoardSort;
    ai: boolean;
    onSort: (s: BoardSort) => void;
    className?: string;
  },
) {
  const items = ai ? [AI, ...ITEMS] : ITEMS;
  return (
    <Select
      value={ai ? "ai" : sort}
      items={items}
      onValueChange={(v) => {
        if (v && v !== "ai") onSort(v as BoardSort);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Sort"
        className={cn("min-h-[40px] max-[640px]:min-h-[44px]", className)}
      >
        <span className="text-white/50">Sort:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {ITEMS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
```

"AI matches" is in `items`, so the trigger can show its label, but it is not rendered as an option: it cannot be picked. Picking the sort that is already in the URL while AI is active still fires `onValueChange`, because the Select value is `"ai"`.

- [ ] **Step 4: Run them and check that they pass**

Run: `deno run -A npm:vitest run app/components/board/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/board/AiSearch.tsx app/components/board/AiSearch.test.tsx app/components/board/filters/SortSelect.tsx app/components/board/filters/SortSelect.test.tsx
git commit -m "AI search: Find matches, says relevant initiatives move first, the latest search wins; Sort reads AI matches while that order is on"
```

---

### Task 7: Desktop toolbar, active filters and board wiring

**Files:**
- Create: `app/components/board/filters/TypeTabs.tsx`, `CategoryFilter.tsx`, `StatusSelect.tsx`, `ActiveFilters.tsx`
- Rewrite: `app/components/board/FilterBar.tsx`
- Modify: `app/routes/board.tsx`
- Test: `app/components/board/FilterBar.test.tsx`, `app/routes/board.test.tsx`

**Interfaces:**
- Consumes: `CLEARED`, `activeFilterCount`, `resultLabel`, `STATUS_LABELS` (Task 4); `SortSelect`, `AiSearch({active})` (Task 6); `CategoryDot` (Task 3).
- Produces:
  - `TypeTabs({ value, counts, onChange })`
  - `CategoryFilter({ value, counts, onChange })`
  - `StatusSelect({ value, onChange })`
  - `ActiveFilters({ view, onChange })`
  - `FilterBar({ view, onChange, counts, shown, total, ai, onSort, sheet })`, where `sheet` is the mobile sheet node from Task 8 (Task 7 passes `null`).

- [ ] **Step 1: Write the failing FilterBar tests**

`app/components/board/FilterBar.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import FilterBar from "./FilterBar";
import { type BoardView, DEFAULT_VIEW } from "~/lib/board-view";
import { CATEGORIES } from "~/lib/categories";

const counts = {
  type: { all: 12, rfp: 7, grant: 5 },
  cats: Object.fromEntries(CATEGORIES.map((c, i) => [c.slug, i])),
};

const bar = (view: Partial<BoardView> = {}, onChange = vi.fn(), onSort = vi.fn()) => {
  render(
    <FilterBar
      view={{ ...DEFAULT_VIEW, ...view }}
      onChange={onChange}
      counts={counts}
      shown={view.cats?.length || view.status ? 3 : 12}
      total={12}
      ai={false}
      onSort={onSort}
      sheet={null}
    />,
  );
  return { onChange, onSort };
};

it("has underlined type tabs with counts and no row of category chips", () => {
  bar();
  expect(screen.getByRole("button", { name: /^All 12/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /^RFPs 7/ })).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("button", { name: /OpSec/ })).toBeNull();
});

it("the Category dropdown lists dot, name and count, and a pick adds to the filter and stays open", async () => {
  const { onChange } = bar({ cats: ["defi"] });
  const trigger = screen.getByRole("combobox", { name: /Category/ });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const list = await screen.findByRole("listbox");
  const opsec = within(list).getByRole("option", { name: /OpSec/ });
  expect(opsec).toHaveTextContent(String(counts.cats.opsec));
  fireEvent.keyDown(screen.getByRole("combobox", { name: /Search categories/ }), {
    key: "ArrowDown",
  });
  fireEvent.click(opsec);
  expect(onChange).toHaveBeenLastCalledWith({ cats: ["defi", "opsec"] });
  expect(screen.getByRole("listbox")).toBeInTheDocument();
});

it("shows active filters with removes and a Clear filters that keeps sort", () => {
  const { onChange } = bar({ cats: ["opsec", "defi"], status: "open", sort: "newest" });
  const row = screen.getByRole("group", { name: "Active filters" });
  fireEvent.click(within(row).getByRole("button", { name: "Remove OpSec" }));
  expect(onChange).toHaveBeenLastCalledWith({ cats: ["defi"] });
  fireEvent.click(within(row).getByRole("button", { name: "Remove Open for funding" }));
  expect(onChange).toHaveBeenLastCalledWith({ status: "all" });
  fireEvent.click(within(row).getByRole("button", { name: "Clear filters" }));
  expect(onChange).toHaveBeenLastCalledWith({ cats: [], status: "all", q: "" });
});

it("hides the active filter row with nothing active, and labels the results", () => {
  bar();
  expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();
  expect(screen.getAllByText("12 initiatives").length).toBeGreaterThan(0);
});

it("says N of M when filtered", () => {
  bar({ cats: ["opsec"] });
  expect(screen.getAllByText("3 of 12 initiatives").length).toBeGreaterThan(0);
});
```

In the Category dropdown test, the order of the keyboard and click steps may need adjusting to how Base UI opens a Combobox with a `Trigger` and an input inside the popup. The assertions are the contract: the callback gets the appended list, and the listbox is still there after a pick.

- [ ] **Step 2: Write the failing board route test**

`app/routes/board.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";
import Board from "./board";

const cards = [
  { id: "a", title: "Alpha fuzzing", type: "rfp", categories: ["fuzzing-testing"] },
  { id: "b", title: "Beta wallets", type: "grant", categories: ["wallets-signing", "opsec"] },
  { id: "c", title: "Gamma opsec", type: "rfp", categories: ["opsec"] },
].map((x, i) => ({
  initiative: {
    id: x.id,
    slug: x.id,
    title: x.title,
    summary: "s",
    goalUsd: 1000,
    status: "approved",
    type: x.type,
    sortRank: null,
    safeAddress: "",
    categories: x.categories,
    createdAt: i,
    approvedAt: i,
  },
  summary: { pledged: 0, received: 0, donated: 0, total: 0, live: false, ledger: 0, paidOut: 0 },
  pct: 0,
  backers: 0,
  donations: 0,
  ledger: null,
  logos: [],
  funded: false,
  donationsEnabled: false,
}));

vi.mock("~/hooks/use-board", () => ({
  boardKey: ["board"],
  useBoard: () => ({
    data: { cards, totals: { raised: 0 }, flags: { aiSearch: true, tokensOk: false } },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("~/components/board/Hero", () => ({ default: () => null }));
vi.mock("~/components/board/PledgeBand", () => ({ default: () => null }));
vi.mock("~/hooks/use-initiative", () => ({ usePrefetchInitiative: () => () => {} }));
vi.mock("~/components/donate/DonateWidget", () => ({ default: () => null }));
const api = vi.fn();
vi.mock("~/lib/api", async (o) => ({
  ...(await o<typeof import("~/lib/api")>()),
  api: (...a: unknown[]) => api(...a),
}));
beforeEach(() => api.mockReset());

const at = (url: string) => {
  const router = createMemoryRouter([{ path: "/", element: <Board /> }], {
    initialEntries: [url],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
};

const titles = () =>
  screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim());

it("restores filters from the URL: count, active row and cards", () => {
  at("/?cat=opsec&sort=newest");
  expect(screen.getAllByText("2 of 3 initiatives").length).toBeGreaterThan(0);
  const row = screen.getByRole("group", { name: "Active filters" });
  expect(within(row).getByText("OpSec")).toBeInTheDocument();
  expect(screen.queryByText("Alpha fuzzing")).toBeNull();
});

it("By category draws plain headings with a count", () => {
  at("/?sort=category");
  expect(screen.getByRole("heading", { name: /Fuzzing & Testing\s*1/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Wallets & Signing\s*1/ })).toBeInTheDocument();
});

it("AI order: Sort shows AI matches, filters still narrow, a manual sort clears it", async () => {
  api.mockResolvedValue({ matches: ["c"] });
  const router = at("/?sort=newest");
  fireEvent.change(screen.getByRole("textbox", { name: /security work/ }), {
    target: { value: "opsec things" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Find matches" }));
  await waitFor(() =>
    expect(screen.getAllByRole("combobox", { name: "Sort" })[0]).toHaveTextContent("AI matches")
  );
  expect(screen.getAllByText("AI pick")).toHaveLength(1);
  const sort = screen.getAllByRole("combobox", { name: "Sort" })[0];
  sort.focus();
  fireEvent.keyDown(sort, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Newest" }));
  await waitFor(() => expect(screen.queryByText("AI pick")).toBeNull());
  expect(router.state.location.search).toContain("sort=newest");
});

it("Clear filters keeps the sort and the AI order", async () => {
  api.mockResolvedValue({ matches: ["b"] });
  const router = at("/?cat=opsec&status=open&sort=newest");
  fireEvent.change(screen.getByRole("textbox", { name: /security work/ }), {
    target: { value: "wallets" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Find matches" }));
  await screen.findByText("AI pick");
  fireEvent.click(
    within(screen.getByRole("group", { name: "Active filters" })).getByRole("button", {
      name: "Clear filters",
    }),
  );
  await waitFor(() => expect(router.state.location.search).toBe("?sort=newest"));
  expect(screen.getByText("AI pick")).toBeInTheDocument();
});
```

Make the fixture's card shape match `Card` in `app/lib/api-types.ts` (see `InitiativeCard.test.tsx`), and add any hook the board or its children call to the mocks. Run the test once to see what is missing. If `titles` is unused, delete it.

- [ ] **Step 3: Run them and check that they fail**

Run: `deno run -A npm:vitest run app/components/board/FilterBar.test.tsx app/routes/board.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement the controls**

`filters/TypeTabs.tsx`:

```tsx
import type { BoardType } from "~/lib/board-view";
import { cn } from "~/lib/utils";

const TABS: [BoardType, string][] = [["all", "All"], ["rfp", "RFPs"], ["grant", "Grants"]];

/** All / RFPs / Grants as underlined tabs sitting on the toolbar's rule. */
export default function TypeTabs(
  { value, counts, onChange }: {
    value: BoardType;
    counts: Record<BoardType, number>;
    onChange: (t: BoardType) => void;
  },
) {
  return (
    <div className="flex gap-5" role="group" aria-label="Type">
      {TABS.map(([t, label]) => (
        <button
          key={t}
          type="button"
          aria-pressed={value === t}
          onClick={() => onChange(t)}
          className={cn(
            "-mb-px min-h-[40px] cursor-pointer border-0 border-b-2 bg-transparent px-0.5 font-inter-tight text-[14px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-dao-bright max-[640px]:min-h-[44px]",
            value === t
              ? "border-dao-green text-white"
              : "border-transparent text-white/60 hover:text-white",
          )}
        >
          {label} <span className="tnum text-white/40">{counts[t]}</span>
        </button>
      ))}
    </div>
  );
}
```

`filters/StatusSelect.tsx`:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/Select";
import type { BoardStatus } from "~/lib/board-view";

const ITEMS = [
  { value: "all", label: "Any funding status" },
  { value: "open", label: "Open for funding" },
  { value: "funded", label: "Fully funded" },
];

export default function StatusSelect(
  { value, onChange }: { value: BoardStatus; onChange: (s: BoardStatus) => void },
) {
  return (
    <Select value={value} items={ITEMS} onValueChange={(v) => onChange(v as BoardStatus)}>
      <SelectTrigger size="sm" aria-label="Funding status" className="min-h-[40px]">
        {value === "all" ? <span>Funding status</span> : <SelectValue />}
      </SelectTrigger>
      <SelectContent>
        {ITEMS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
```

`filters/CategoryFilter.tsx`:

```tsx
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search } from "lucide-react";
import CategoryDot from "~/components/ui/CategoryDot";
import { CATEGORIES, categoryOf } from "~/lib/categories";

const SLUGS = CATEGORIES.map((c) => c.slug as string);
const label = (s: string) => categoryOf(s)?.label ?? s;

/** The Category dropdown: search, then any number of categories, each with its
 * dot, name, check and live count. Picks apply at once and the menu stays open. */
export default function CategoryFilter(
  { value, counts, onChange }: {
    value: string[];
    counts: Record<string, number>;
    onChange: (cats: string[]) => void;
  },
) {
  return (
    <Combobox.Root
      items={SLUGS}
      multiple
      value={value}
      itemToStringLabel={label}
      onValueChange={(next: string[]) => onChange(next)}
      onInputValueChange={(_v, details) => {
        if (details.isItemPress) details.cancel();
      }}
    >
      <Combobox.Trigger
        aria-label={value.length ? `Category, ${value.length} selected` : "Category"}
        className="field flex min-h-[40px] w-auto cursor-pointer items-center gap-2 whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-[12px] data-[popup-open]:border-[rgba(92,183,90,.6)]"
      >
        Category
        {value.length > 0 && (
          <span className="rounded-full bg-white/10 px-1.5 text-[11px] tnum text-white">
            {value.length}
          </span>
        )}
        <ChevronDown className="size-3.5 text-white/50" aria-hidden="true" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} align="start" className="z-[210]">
          <Combobox.Popup className="w-[300px] rounded-[14px] border border-edge2 bg-panel shadow-menu outline-none">
            <div className="relative border-b border-white/10 p-1.5">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/40" />
              <Combobox.Input
                aria-label="Search categories"
                placeholder="Search categories"
                className="h-9 w-full rounded-[9px] border-0 bg-white/[.04] pl-8 pr-2 text-[13px] text-white outline-none placeholder:text-white/30"
              />
            </div>
            <Combobox.Empty className="px-3 py-2.5 small dim">No category matches.</Combobox.Empty>
            <Combobox.List className="max-h-[min(var(--available-height),340px)] overflow-y-auto p-1.5">
              {(s: string) => (
                <Combobox.Item
                  key={s}
                  value={s}
                  className="flex min-h-[38px] cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-2.5 font-inter-tight text-[13.5px] text-soft outline-none data-[highlighted]:bg-white/[.06] data-[highlighted]:text-white"
                >
                  <CategoryDot slug={s} />
                  <span className="flex-1">{label(s)}</span>
                  <Combobox.ItemIndicator>
                    <Check className="size-4 text-dao-green" aria-hidden="true" />
                  </Combobox.ItemIndicator>
                  <span className="w-6 text-right tnum text-white/40">{counts[s] ?? 0}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
```

Check against the local combobox docs ("Input inside popup", lines 1872+) that a `Combobox.Trigger` without a `Combobox.Input` in the anchor is the documented shape. If the demo uses `Combobox.Value` in the trigger, follow the demo.

`filters/ActiveFilters.tsx`:

```tsx
import { X } from "lucide-react";
import CategoryDot from "~/components/ui/CategoryDot";
import { type BoardView, CLEARED, STATUS_LABELS } from "~/lib/board-view";
import { categoryOf } from "~/lib/categories";

const TOKEN =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[.05] pl-2.5 pr-1 font-inter-tight text-[12.5px] text-white/85";
const REMOVE =
  "grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/55 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-dao-bright";

/** The selected categories and funding status, each removable, and Clear filters. */
export default function ActiveFilters(
  { view, onChange }: { view: BoardView; onChange: (next: Partial<BoardView>) => void },
) {
  if (!view.cats.length && view.status === "all") return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Active filters">
      {view.cats.map((s) => {
        const name = categoryOf(s)?.label ?? s;
        return (
          <span key={s} className={TOKEN}>
            <CategoryDot slug={s} />
            {name}
            <button
              type="button"
              className={REMOVE}
              aria-label={`Remove ${name}`}
              onClick={() => onChange({ cats: view.cats.filter((c) => c !== s) })}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        );
      })}
      {view.status !== "all" && (
        <span className={TOKEN}>
          {STATUS_LABELS[view.status]}
          <button
            type="button"
            className={REMOVE}
            aria-label={`Remove ${STATUS_LABELS[view.status]}`}
            onClick={() => onChange({ status: "all" })}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      )}
      <button
        type="button"
        className="ml-1 cursor-pointer border-0 bg-transparent p-0 font-inter-tight text-[12.5px] text-dao-green underline"
        onClick={() => onChange({ ...CLEARED })}
      >
        Clear filters
      </button>
    </div>
  );
}
```

`FilterBar.tsx` (full rewrite):

```tsx
import { SlidersHorizontal } from "lucide-react";
import {
  activeFilterCount,
  type BoardSort,
  type BoardType,
  type BoardView,
  isFiltered,
  resultLabel,
} from "~/lib/board-view";
import ActiveFilters from "./filters/ActiveFilters";
import CategoryFilter from "./filters/CategoryFilter";
import SortSelect from "./filters/SortSelect";
import StatusSelect from "./filters/StatusSelect";
import TypeTabs from "./filters/TypeTabs";

/**
 * Between the AI search and the grid. Desktop: one row of type tabs, Category,
 * Funding status, then the count and Sort on the right; at middle widths the
 * controls wrap under the tabs as a second row. Phones (<=640px): the tabs,
 * then the count, Filters (N) (the sheet) and Sort. The active filters follow
 * on their own row.
 */
export default function FilterBar({
  view,
  onChange,
  counts,
  shown,
  total,
  ai,
  onSort,
  sheet,
}: {
  view: BoardView;
  onChange: (next: Partial<BoardView>) => void;
  counts: { type: Record<BoardType, number>; cats: Record<string, number> };
  shown: number;
  total: number;
  ai: boolean;
  onSort: (s: BoardSort) => void;
  /** The phone Filters button and its sheet (Task 8); null hides it. */
  sheet: React.ReactNode;
}) {
  const label = resultLabel(shown, total, isFiltered(view));
  const n = activeFilterCount(view);
  return (
    <div className="mb-5 flex flex-col gap-3" role="group" aria-label="Filter and sort initiatives">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-white/10 max-[640px]:border-b-0">
        <div className="max-[640px]:w-full max-[640px]:border-b max-[640px]:border-white/10">
          <TypeTabs value={view.type} counts={counts.type} onChange={(type) => onChange({ type })} />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 pb-2 max-[640px]:hidden">
          <CategoryFilter
            value={view.cats}
            counts={counts.cats}
            onChange={(cats) => onChange({ cats })}
          />
          <StatusSelect value={view.status} onChange={(status) => onChange({ status })} />
          <span className="ml-auto flex items-center gap-3">
            <span className="small dim tnum" aria-live="polite">{label}</span>
            <SortSelect sort={view.sort} ai={ai} onSort={onSort} />
          </span>
        </div>
      </div>
      <div className="hidden items-center gap-2 max-[640px]:flex">
        <span className="mr-auto small dim tnum" aria-live="polite">{label}</span>
        {sheet ?? (
          <span className="sr-only">
            <SlidersHorizontal /> Filters ({n})
          </span>
        )}
        <SortSelect sort={view.sort} ai={ai} onSort={onSort} />
      </div>
      <ActiveFilters view={view} onChange={onChange} />
    </div>
  );
}
```

Task 8 replaces the `sheet ?? …` fallback. Until then, the fallback keeps phones from showing a dead button. Drop it in Task 8.

In the intermediate range (641–~1000px), the controls group has `flex-1` and wraps under the tabs when it does not fit. That gives a deliberate second row. `flex-wrap` inside the group lets Sort drop to a third row rather than overflow. Nothing scrolls sideways and nothing is hidden.

`board.tsx` changes:
- `const ai = Boolean(matches?.length);`
- `const onSort = (sort: BoardSort) => { setMatches(null); setView({ sort }); };`
- `<AiSearch active={ai} onMatches={setMatches} />`
- `<FilterBar … ai={ai} onSort={onSort} sheet={null} />`
- Empty state: `onClick={() => setView({ ...CLEARED })}`. It keeps its "Clear filters" button text.
- Group heading: replace `<CategoryTag slug={g.slug} />` with

```tsx
<h3 className="mb-3 mt-6 flex items-center gap-2 font-inter-tight text-[14px] font-medium text-white first:mt-0">
  {g.slug ? <><CategoryDot slug={g.slug} />{categoryOf(g.slug)?.label}</> : "Untagged"}
  <span className="small dim tnum">{g.cards.length}</span>
</h3>
```

- Imports: `CLEARED`, `type BoardSort` from board-view; `CategoryDot`; `categoryOf`. Remove `CategoryTag`.

The card title element is an `h3` (Task 5), and group headings are `h3` too. If that makes the heading outline confusing, make the card titles `h3` and the group headings `h2` with the same classes. Check with the board test's heading queries, and adjust `level` there to match.

- [ ] **Step 5: Run the tests and check that they pass**

Run: `deno run -A npm:vitest run app/components/board/ app/routes/board.test.tsx app/lib/board-view.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint and commit**

Run: `deno task typecheck && deno task lint`

```bash
git add app/components/board/ app/routes/board.tsx app/routes/board.test.tsx
git commit -m "Board toolbar: underlined type tabs, a searchable Category dropdown with counts, Funding status and Sort, a row of active filters with Clear filters that keeps sort and the AI order, N of M initiatives, plain By category headings"
```

---

### Task 8: Mobile filter sheet

**Files:**
- Create: `app/components/board/filters/FilterSheet.tsx`
- Modify: `app/components/board/FilterBar.tsx` (drop the fallback), `app/routes/board.tsx`
- Test: `app/components/board/filters/FilterSheet.test.tsx`

**Interfaces:**
- Consumes: `applyView`, `facetCounts`, `activeFilterCount`, `CLEARED`, `STATUS_LABELS` (Task 4); `CategoryDot`.
- Produces: `FilterSheet({ cards: Card[], view: BoardView, onApply: (next: Pick<BoardView, "cats" | "status">) => void })`, which renders the **Filters (N)** trigger and the sheet.

- [ ] **Step 1: Read the Drawer docs**

Read the start of `node_modules/@base-ui/react/docs/react/components/drawer.md` (anatomy), plus "Position" and "Virtual keyboard aware" (line 1697). Use the anatomy and keyboard handling those sections show. If Drawer's API differs from `Drawer.Root / Trigger / Portal / Backdrop / Popup / Title / Close`, use the documented names. If Drawer is marked unstable or needs a provider that is not installed, use `@base-ui/react/dialog` with the same markup positioned at the bottom.

- [ ] **Step 2: Write the failing tests**

`app/components/board/filters/FilterSheet.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import FilterSheet from "./FilterSheet";
import { DEFAULT_VIEW } from "~/lib/board-view";
import type { Card } from "~/lib/api-types";

const mk = (id: string, cats: string[], funded = false) =>
  ({
    initiative: { id, type: "rfp", categories: cats, title: id, summary: "", goalUsd: 1 },
    funded,
  }) as unknown as Card;
const cards = [mk("a", ["opsec"]), mk("b", ["defi"]), mk("c", ["opsec", "defi"], true)];

const sheet = (view = DEFAULT_VIEW, onApply = vi.fn(), list = cards) => {
  const utils = render(<FilterSheet cards={list} view={view} onApply={onApply} />);
  return { ...utils, onApply };
};
const openSheet = () => fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
const dialog = () => screen.getByRole("dialog", { name: "Filters" });

it("the button counts the active filters", () => {
  sheet({ ...DEFAULT_VIEW, cats: ["opsec"], status: "open" });
  expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
});

it("changes are provisional: the count previews, Show applies", () => {
  const { onApply } = sheet();
  openSheet();
  expect(within(dialog()).getByRole("button", { name: "Show 3 initiatives" })).toBeInTheDocument();
  fireEvent.click(within(dialog()).getByRole("checkbox", { name: /OpSec/ }));
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(within(dialog()).getByRole("radio", { name: "Open for funding" }));
  const show = within(dialog()).getByRole("button", { name: "Show 1 initiative" });
  fireEvent.click(show);
  expect(onApply).toHaveBeenCalledWith({ cats: ["opsec"], status: "open" });
});

it("closing discards, and reopening shows the applied state", async () => {
  const { onApply } = sheet({ ...DEFAULT_VIEW, cats: ["defi"] });
  openSheet();
  fireEvent.click(within(dialog()).getByRole("checkbox", { name: /OpSec/ }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(onApply).not.toHaveBeenCalled();
  openSheet();
  expect(within(dialog()).getByRole("checkbox", { name: /OpSec/ })).not.toBeChecked();
  expect(within(dialog()).getByRole("checkbox", { name: /DeFi/ })).toBeChecked();
});

it("Reset clears the provisional state only", () => {
  const { onApply } = sheet({ ...DEFAULT_VIEW, cats: ["defi"], status: "funded" });
  openSheet();
  fireEvent.click(within(dialog()).getByRole("button", { name: "Reset" }));
  expect(within(dialog()).getByRole("checkbox", { name: /DeFi/ })).not.toBeChecked();
  expect(onApply).not.toHaveBeenCalled();
});

it("searches categories inline", () => {
  sheet();
  openSheet();
  fireEvent.change(within(dialog()).getByRole("searchbox", { name: "Search categories" }), {
    target: { value: "wall" },
  });
  expect(within(dialog()).getAllByRole("checkbox")).toHaveLength(1);
});

it("focus returns to the Filters button on close", async () => {
  sheet();
  const btn = screen.getByRole("button", { name: /^Filters/ });
  btn.focus();
  fireEvent.click(btn);
  fireEvent.keyDown(dialog(), { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(btn));
});

it("a board refetch while open keeps the provisional picks", () => {
  const { rerender } = sheet();
  openSheet();
  fireEvent.click(within(dialog()).getByRole("checkbox", { name: /OpSec/ }));
  rerender(<FilterSheet cards={[...cards]} view={{ ...DEFAULT_VIEW }} onApply={vi.fn()} />);
  expect(within(dialog()).getByRole("checkbox", { name: /OpSec/ })).toBeChecked();
});
```

- [ ] **Step 3: Run them and check that they fail**

Run: `deno run -A npm:vitest run app/components/board/filters/FilterSheet.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

`filters/FilterSheet.tsx`:

```tsx
import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Drawer } from "@base-ui/react/drawer";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check, Search, SlidersHorizontal, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "~/components/ui/Button";
import CategoryDot from "~/components/ui/CategoryDot";
import type { Card } from "~/lib/api-types";
import {
  activeFilterCount,
  applyView,
  type BoardStatus,
  type BoardView,
  facetCounts,
} from "~/lib/board-view";
import { CATEGORIES } from "~/lib/categories";
import { plural } from "~/lib/format";

type Picks = Pick<BoardView, "cats" | "status">;
const STATUSES: [BoardStatus, string][] = [
  ["all", "Any funding status"],
  ["open", "Open for funding"],
  ["funded", "Fully funded"],
];

/**
 * Phones: Filters (N) opens a bottom sheet with the category search and list
 * and the funding status. Picks are provisional until Show N initiatives;
 * closing discards them, Reset clears them. The footer sits above the safe area.
 */
export default function FilterSheet(
  { cards, view, onApply }: { cards: Card[]; view: BoardView; onApply: (p: Picks) => void },
) {
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<Picks>({ cats: view.cats, status: view.status });
  const [q, setQ] = useState("");
  const searchId = useId();
  const next = { ...view, ...picks };
  const shown = useMemo(() => applyView(cards, next).length, [cards, next.cats, next.status, view]);
  const counts = useMemo(() => facetCounts(cards, next).cats, [cards, next.cats, next.status, view]);
  const list = CATEGORIES.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setPicks({ cats: view.cats, status: view.status });
          setQ("");
        }
        setOpen(o);
      }}
    >
      <Drawer.Trigger className="field inline-flex min-h-[44px] w-auto cursor-pointer items-center gap-2 rounded-[10px] px-3 text-[13px]">
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        Filters ({activeFilterCount(view)})
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-[200] bg-[rgba(15,30,44,.62)] backdrop-blur-[4px]" />
        <Drawer.Popup className="fixed inset-x-0 bottom-0 z-[205] flex max-h-[85dvh] flex-col rounded-t-[18px] border border-edge2 bg-panel-modal shadow-modal outline-none">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <Drawer.Title className="m-0 font-inter-tight text-[18px] font-medium text-white">
              Filters
            </Drawer.Title>
            <Drawer.Close
              aria-label="Close"
              className="grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/70"
            >
              <X className="size-5" aria-hidden="true" />
            </Drawer.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
            <label htmlFor={searchId} className="k mb-2 block">Category</label>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
              <input
                id={searchId}
                type="search"
                aria-label="Search categories"
                placeholder="Search categories"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="field min-h-[44px] pl-9"
              />
            </div>
            <CheckboxGroup
              value={picks.cats}
              onValueChange={(cats: string[]) => setPicks((p) => ({ ...p, cats }))}
              aria-label="Categories"
              className="flex flex-col"
            >
              {list.map((c) => (
                <label
                  key={c.slug}
                  className="flex min-h-[44px] cursor-pointer items-center gap-3 border-b border-white/[.06] font-inter-tight text-[14px] text-soft"
                >
                  <Checkbox.Root
                    value={c.slug}
                    className="grid size-5 flex-none place-items-center rounded-[5px] border border-white/25 bg-transparent data-[checked]:border-dao-green data-[checked]:bg-dao-green"
                  >
                    <Checkbox.Indicator>
                      <Check className="size-3.5 text-[#08321c]" aria-hidden="true" />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  <CategoryDot slug={c.slug} />
                  <span className="flex-1">{c.label}</span>
                  <span className="tnum text-white/40">{counts[c.slug] ?? 0}</span>
                </label>
              ))}
              {!list.length && <p className="m-0 py-3 small dim">No category matches.</p>}
            </CheckboxGroup>
            <span className="k mb-2 mt-5 block" id={`${searchId}-status`}>Funding status</span>
            <RadioGroup
              value={picks.status}
              onValueChange={(status) => setPicks((p) => ({ ...p, status: status as BoardStatus }))}
              aria-labelledby={`${searchId}-status`}
              className="flex flex-col"
            >
              {STATUSES.map(([v, label]) => (
                <label
                  key={v}
                  className="flex min-h-[44px] cursor-pointer items-center gap-3 font-inter-tight text-[14px] text-soft"
                >
                  <Radio.Root
                    value={v}
                    className="grid size-5 place-items-center rounded-full border border-white/25 data-[checked]:border-dao-green"
                  >
                    <Radio.Indicator className="size-2.5 rounded-full bg-dao-green" />
                  </Radio.Root>
                  {label}
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="flex items-center gap-3 border-t border-white/10 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
            <Button
              variant="ghost"
              onClick={() => setPicks({ cats: [], status: "all" })}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                onApply(picks);
                setOpen(false);
              }}
            >
              Show {plural(shown, "initiative")}
            </Button>
          </div>
        </Drawer.Popup>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

Notes:
- The trigger's accessible name must be exactly "Filters (N)". The icon is `aria-hidden`.
- The labels wrap their checkbox or radio so the whole 44px row is the target, and each control's name is the row text. If Base UI's `Checkbox.Root` renders a `button role="checkbox"`, a wrapping `label` still names it. Check this in the test. If the name comes out empty, add `aria-label={c.label}`.
- Keyboard: the body is the scroll container, and `max-h-[85dvh]` shrinks with the on-screen keyboard where `dvh` does. Also apply what the Drawer "Virtual keyboard aware" section asks for, if it gives a CSS variable or a prop.
- The provisional picks are reset only in `onOpenChange(true)`, never from props, so a refetch while the sheet is open keeps them (Review Focus #4).

`FilterBar.tsx`: replace `{sheet ?? (…)}` with `{sheet}`, and drop the `SlidersHorizontal` import and `n` if they are now unused.

`board.tsx`: `sheet={<FilterSheet cards={all} view={view} onApply={(p) => setView(p)} />}`.

- [ ] **Step 5: Run the tests and check that they pass**

Run: `deno run -A npm:vitest run app/components/board/ app/routes/board.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/board/ app/routes/board.tsx
git commit -m "Phones: Filters (N) opens a bottom sheet with an inline category search, 44px rows and funding status; picks stay provisional until Show N initiatives, Close discards, Reset clears, the footer sits above the safe area"
```

---

### Task 9: Cleanup and the guide

**Files:**
- Modify: `app/components/ui/CategoryTag.tsx` (delete `CategoryChip`)
- Modify: `app/app.css` (delete the unused `.cat-on` / `.cat-dim` / chip-only rules)
- Modify: `public/llms.txt`
- Test: `app/data/guide.test.ts` (existing; must still pass)

- [ ] **Step 1: Remove dead code**

Run: `grep -rn "CategoryChip\|cat-on\|cat-dim" app/`
Delete `CategoryChip` from `CategoryTag.tsx` and the CSS rules that only it used. Keep `CategoryTag` and `CategoryLink`: the detail page (`initiative.tsx:110`), the admin header and the admin list use them, and the spec keeps full names on detail pages.

- [ ] **Step 2: Update the guide**

In `public/llms.txt`, under "## Step 3: Deliver the document plus the scorecard", add a paragraph before its first subsection. It is outside every ```markdown block, so `guide.test.ts` and the splitter are unaffected:

```
Categories are not part of the document. After the proposer pastes it into the form, they pick 1 to 3 categories in the form's Categories field; the first one is the primary category. The form can suggest categories from the title and summary, and the proposer applies them with Use suggestions. Do not add a Categories heading to the document: the site would not read it.
```

Also add one line to your scorecard instructions, if that section lists what the proposer does next: "Next: paste the document, then pick the categories."

- [ ] **Step 3: Run the guide and full web tests**

Run: `deno task test`
Expected: PASS apart from the known CRLF-only failures (`rules.test`, `PasteBox`) on Windows checkouts. On Linux, expect everything to pass.

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/CategoryTag.tsx app/app.css public/llms.txt
git commit -m "Guide: categories are picked in the form after pasting, never a heading in the document; chip toggle and its styles removed"
```

---

### Task 10: Full verification and screenshots

- [ ] **Step 1: Run every check**

Run each and read the output:

```bash
deno task test
deno task test:api
deno task typecheck
deno task check:api
deno task lint
deno fmt --check
deno task build
```

Expected: all clean except the known `kv-depth` API failure (it also fails on main). Record the board chunk size from the build output, and compare it with PR #55's 11.36 kB gzipped board chunk (the budget is 15 kB above the pre-categories 9.30 kB). If Base UI's combobox, drawer and popover push it over, lazy-load `FilterSheet` with `React.lazy` inside the phone row.

- [ ] **Step 2: Start the app with tagged data**

Use the `run` skill. PR #55 did its visual QA against production data with the categories injected. Do the same here:
- start the web app against the production API, `API_PROXY=<prod origin> deno task dev:web` (the origin is in `.env` or the README);
- because production is not seeded yet, inject categories in the browser. Intercept `/api/board` with a `fetch` wrapper installed through `javascript_tool`, then trigger a board refetch, or temporarily point the dev proxy at a local API seeded with `deno task seed-categories`.

Pick whichever of the two works on the first try. Do not commit any injection code.

- [ ] **Step 3: Capture screenshots (Claude in Chrome)**

At 1440, 768, 640, 390 and 320px, check that the page does not scroll sideways (`document.documentElement.scrollWidth <= innerWidth` through `javascript_tool`). Capture:
1. The desktop board toolbar, no filters (1440).
2. Desktop with the Category menu open, showing dots, checks and counts, and with active filters plus Clear filters.
3. The AI "Find matches" result, with Sort reading "AI matches".
4. "By category" headings.
5. The intermediate toolbar rows (768 and 640).
6. The phone board (390), the Filters sheet open, and the sheet with the keyboard up (focus the search; emulate a short viewport by resizing to 390×500).
7. Card titles at 320 and 390: 0, 1 and 3 dots, a one-word title and a long last word.
8. The dot tooltip on hover and the popover on click.
9. The submit picker: empty with a suggestion, tokens, the three-category limit and Primary category. The edit picker. The admin Categories panel.

Save the screenshots or a GIF with meaningful names, and list them in the PR description.

- [ ] **Step 4: Fix what the screenshots show**

For each visual defect, fix it and re-run the related test file, then run Step 1 again in full before the final commit.

- [ ] **Step 5: Final commit and PR**

Ask the user before pushing or opening the PR. When approved:

```bash
git push -u origin categories-ui
gh pr create --base categories-p0 --title "Categories UI: compact filters, card dots, one picker" --body "<summary, checks, screenshots, and 'Follow-up to #55; deploy and prod seeding stay separate'>"
```

---

### Task 11 (added 2026-09-29 at the user's request): Categories in the pasted document

Run it before Task 10. The spec now says categories are part of the draft text.

**Files:** `shared/categories.ts` (`readCategoryText`, `categoriesText`), `shared/draft/types.ts` (PageKey `categories`), `shared/draft/sections.ts` (aliases), `app/components/initiative-form/draft-text.ts` (render + replace), `app/components/initiative-form/useDraft.ts` (`splitReport`), `app/components/initiative-form/PasteBox.tsx` (hints, placeholder), `public/llms.txt` (format, rules, example), tests beside each.

**Interfaces:**
- `readCategoryText(text: string): { slugs: string[]; unknown: string[] }`: accepts lines, commas or semicolons, bullets or numbers, labels (case-insensitive, `&` or `and`) or slugs. Keeps known ones in order, unique, at most 3; `unknown` lists the tokens it could not read.
- `categoriesText(slugs: string[]): string`: labels, one per line.
- `splitReport(...)` gains `categories: number` and `unknownCategories: string[]`.

**Behaviour:**
- `## Categories` (aliases `category`, `tags`) sits after `## Short summary` in `renderDraft`.
- `replaceFromText` sets `categories` from it. A missing heading empties the list, as with every other field.
- Paste hints: unknown names get their own line naming the valid ones. With no categories found, the hint says to put 1 to 3 under `## Categories`.
- The guide lists the ten names in the output format, with rules (1 to 3, primary first, exact names), and the gold-standard example carries a Categories section.

**Tests (red first):**
- The parser handles labels, slugs, bullets, commas, case, `and`/`&`, duplicates, more than 3 and unknowns.
- A render and replace round trip keeps the order.
- Pasting a document fills `draft.categories`.
- A missing heading empties it.
- `splitReport` counts and names unknowns.
- The guide example parses to valid slugs.
