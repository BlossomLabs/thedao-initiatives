import { Combobox } from "@base-ui/react/combobox";
import { Check, X } from "lucide-react";
import { useId, useRef } from "react";
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

const SLUGS: string[] = CATEGORIES.map((c) => c.slug);
const labelOf = (s: string) => categoryOf(s)?.label ?? s;

/** Keep the existing order; anything new goes last. */
const keepOrder = (was: string[], next: string[]) => [
  ...was.filter((s) => next.includes(s)),
  ...next.filter((s) => !was.includes(s)),
];

/**
 * 1 to 3 categories in one searchable field: the picked ones are removable
 * tokens inside it and the first is primary (a Primary category select appears
 * with two or more). At three the other options are disabled. An AI
 * suggestion, given while the field is empty, is offered and never applied.
 */
export default function CategoriesPicker({
  value,
  onChange,
  suggestion,
  id,
  label = "Categories",
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
  /** Under the field: the findings. */
  message?: React.ReactNode;
}) {
  const labelId = useId();
  // The menu opens under the whole field, not under the text input inside it.
  const field = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const full = value.length >= MAX_CATEGORIES;
  return (
    <div className="mt-4" data-field="categories">
      <span className="label" id={labelId}>{label} *</span>
      <p className="hint m-0 mb-2" id={hintId}>
        Pick 1 to 3. The first one is the primary category.
      </p>
      <Combobox.Root
        items={SLUGS}
        multiple
        value={value}
        disabled={disabled}
        itemToStringLabel={labelOf}
        onValueChange={(next: string[]) =>
          onChange(keepOrder(value, next).slice(0, MAX_CATEGORIES))}
        onOpenChange={(open, details) => {
          // keep the list open for the next pick
          if (!open && details.reason === "item-press") details.cancel();
        }}
      >
        <Combobox.Chips
          ref={field}
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
                    {labelOf(s)}
                    <Combobox.ChipRemove
                      aria-label={`Remove ${labelOf(s)}`}
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
          <Combobox.Positioner
            anchor={field}
            sideOffset={6}
            className="z-[210] w-(--anchor-width)"
          >
            <Combobox.Popup className="max-h-[min(var(--available-height),320px)] overflow-y-auto overscroll-contain rounded-[14px] border border-edge2 bg-panel p-1.5 shadow-menu outline-none">
              <Combobox.Empty className="small dim empty:hidden px-3 py-2.5">
                No category matches.
              </Combobox.Empty>
              <Combobox.List>
                {(s: string) => (
                  <Combobox.Item
                    key={s}
                    value={s}
                    disabled={full && !value.includes(s)}
                    className="flex min-h-[40px] cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-3 font-inter-tight text-[14px] text-soft outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[highlighted]:bg-white/[.06] data-[highlighted]:text-white max-[641px]:min-h-[44px]"
                  >
                    <CategoryDot slug={s} />
                    <span className="flex-1">{labelOf(s)}</span>
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
      {!value.length && suggestion?.length
        ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 small dim">
            <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
              Suggested:
              {suggestion.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5 text-white/80">
                  <CategoryDot slug={s} />
                  {labelOf(s)}
                </span>
              ))}
            </span>
            <Button sm variant="ghost" disabled={disabled} onClick={() => onChange(suggestion)}>
              Use suggestions
            </Button>
          </div>
        )
        : null}
      {value.length > 1 && (
        <div className="mt-2.5 flex items-center gap-2.5 small dim">
          Primary category
          <Select
            value={value[0]}
            items={value.map((s) => ({ value: s, label: labelOf(s) }))}
            disabled={disabled}
            onValueChange={(v) => v && onChange([v as string, ...value.filter((s) => s !== v)])}
          >
            <SelectTrigger size="sm" aria-label="Primary category" className="min-h-[36px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {value.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {message}
    </div>
  );
}
