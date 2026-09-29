# Category UI redesign

## Direction

Create a restrained discovery interface with clear hierarchy: initiative titles lead, filters stay compact, and category colour appears as a small accent.

Keep the existing branding, typography, hero, and card structure. Redesign the search/filter area, card category indicators, and category pickers in submit, edit, and admin forms.

## Board filtering

- **Desktop:** keep AI search above a compact toolbar. Use underlined **All / RFPs / Grants** tabs, **Category** and **Funding status** dropdowns, and a right-aligned **Sort** control. Remove the row of ten coloured chips.
  - *Changed 2026-09-29 after review with the user:* "Filters:" then one row of small pills (Type with All / RFPs / Grants, Category, Funding), with the count and a quiet text Sort on the right. There is no applied-filters row: each pill shows its own state (Category names one pick, reads "N Categories" for several, its dots show the picks; Funding shows a ring glyph like the funding bar), and a "Clear filters" link follows the pills while anything is filtered, resetting type, categories and funding status. Type shows a small badge icon in the card badges' colours. The AI search keeps its placeholder; its button is joined to the input on every width, and after a search the note says the matches moved to the front and the filters still apply. On phones: Type, Filters (N) and Sort pills, then the count and Clear filters.
- **Categories:** use a searchable multi-select dropdown. Each option shows a colour dot, category name, checkmark when selected, and muted result count. Selections update immediately; the menu remains open for further choices. Board filtering permits any number of categories.
- **Active filters:** show a separate, lightweight row containing only selected categories and funding restrictions, with individual remove buttons and **Clear filters**. Use neutral backgrounds and small dots. Clearing filters preserves sorting and the AI query.
- **Results:** show “N initiatives” by default and “N of M initiatives” when filtered. Keep existing category OR logic and the intersection with type and funding status.
- **Mobile, ≤640px:** keep type tabs visible. Put the result count, **Filters (N)** button, and **Sort** beneath them. Filters opens a bottom sheet containing category search/multi-selection and funding status. Changes remain provisional until **Show N initiatives** is pressed; closing or cancelling discards them. Include a reset action and a fixed footer above the device’s safe area.
- **Intermediate widths:** allow deliberate toolbar rows without horizontally scrolling the page or hiding controls.
- **AI matching:** retain the existing ranking behavior and label the action **Find matches**. Explain that relevant initiatives move first. While active, sorting displays **AI matches**; selecting a manual sort clears AI ordering. Filters continue to narrow the ranked results.
- Preserve all eight existing sorts. “By category” uses plain section headings with a dot and count.

Controls use consistent heights, quiet borders, readable text, and solid dark menu surfaces. Category colours never fill entire filter buttons.

## Card indicators and category selection

**Card titles**

- Replace category pills with up to three **8px colour dots**, separated by 4px, following the title with an 8px gap. Preserve category order, with the primary category first.
  - *Changed 2026-09-29 after review with the user:* the card shows the primary category's icon, in its colour, before the title instead of the dots after it; it is the same one button (24px target, tooltip naming every category, popover with a row per category that browses the board by it, marked with a chevron). The title is one plain link, so the last-word grouping below no longer applies. Dots stay in the Category pill, the menus and the form picker, with a dark inner and white outer ring.
- Wrap the final title word and the complete dot group together. They move to the next line as one unit; dots never occupy a line alone.
- Keep title navigation and the dot trigger as separate controls without nested interactive elements. Render the title prefix and final word as links to the same destination, with one keyboard-accessible title link whose accessible name contains the full title.
- For an exceptionally long final word that cannot fit with the dots, truncate that word within the group; preserve the full title in its accessible name and tooltip.
- Treat the dot group as one accessible target, at least 24px square. Hover or focus reveals category names; click/tap opens a persistent popover with names and **Browse category** links. Escape dismisses it and restores focus. No category navigation happens merely from tapping the dots.
- Untagged cards have no marker or reserved gap. Keep full category names on initiative detail pages.

**Submission, edit, and admin forms**

- Replace the chip grid with one searchable multi-select using the installed [Base UI Combobox](https://base-ui.com/react/components/combobox).
- Show selected names as neutral removable tokens inside the field. Options contain a dot, name, and checkmark; form menus omit board result counts.
- Keep the existing requirement of **1–3 categories**. At three selections, disable additional options while keeping selected options removable, with a clear limit message.
- The first selection becomes primary. When multiple categories are selected, show a compact **Primary category** selector containing only those selections. Changing it updates their stored order.
- Use optional AI suggestions with a **Use suggestions** action. Apply only to an empty field; never replace manual selections automatically. Invalidate suggestions when their source text changes and ignore stale responses.
- On phones, keep the field full-width and constrain its menu to the available viewport, including when the keyboard is open. Use 44px option rows. Inside the filter sheet, present the category search and options inline.

## State, interfaces, and compatibility

- Keep existing API endpoints, category slugs, colours, validation rules, and board URL parameters. No database migration is required.
- Move submit/edit category state into the client draft and payload types so autosave, restore, discard, wallet switching, validation, and preview share one source of truth. Older saved drafts default to an empty category list.
- Categories are part of the pasted/generated draft text as a `## Categories` section (1 to 3 names or slugs, primary first), parsed into the category field and mirrored back into the text; the picker reviews and changes them. They stay outside text revisions. Category-only edits retain the existing PATCH behavior and approval permissions. (Changed 2026-09-29, after the first implementation pass: originally categories stayed outside the draft text.)
- Include categories in live required-field counts, submission findings, and field focus. Remove the contradictory “Nothing blocks this submission” state.
- Reuse Base UI primitives for comboboxes, popovers, and the mobile dialog, including focus management and dismissal behavior.
- Update the drafting guide: the output format gains a Categories section listing the ten category names, and the examples carry one.
- Implement as a follow-up to PR #55. Preserve unrelated work; deployment and production category seeding remain separate.

## Validation

- Test desktop filtering, counts, clearing, URL reloads, category grouping, and AI/manual-sort transitions.
- Test mobile apply/cancel/reset behavior, provisional counts, focus restoration, scrolling, and keyboard-visible layouts.
- Verify title wrapping with zero to three dots, long and single-word titles, and widths of 320, 390, 640, 768, and 1440px.
- Test keyboard multi-selection, removal, the three-category limit, primary-category changes, and labelled dot popovers.
- Cover the three review regressions: stale AI responses, restored categories, and accurate validation. Also verify suggestions require explicit application and survive no unintended draft transitions.
- Run web/API tests, typechecks, lint, and production build. Capture browser screenshots of desktop/mobile boards, active filters, the mobile sheet, dot popovers, and category pickers before considering the redesign complete.
