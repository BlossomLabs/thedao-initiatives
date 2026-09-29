import { Combobox } from "@base-ui/react/combobox";
import { useRef } from "react";
import { useTakeFocus } from "~/lib/focus-handover";
import { Check, Search } from "lucide-react";
import CategoryDot from "~/components/ui/CategoryDot";
import { CATEGORIES, categoryOf } from "~/lib/categories";
import { cn } from "~/lib/utils";
import {
  FILTER_FOCUS_KEY,
  FILTER_PILL_ON,
  TRIGGER,
  TriggerFace,
  triggerLabel,
} from "./CategoryTrigger";

const SLUGS: string[] = CATEGORIES.map((c) => c.slug);
const labelOf = (s: string) => categoryOf(s)?.label ?? s;

/**
 * The Category dropdown: a search, then any number of categories, each with
 * its dot, name, check and live count. Picks apply at once and the menu stays
 * open for the next one.
 */
export default function CategoryFilter(
  { value, counts, onChange }: {
    value: string[];
    counts: Record<string, number>;
    onChange: (cats: string[]) => void;
  },
) {
  const trigger = useRef<HTMLButtonElement>(null);
  useTakeFocus(FILTER_FOCUS_KEY, trigger);
  return (
    <Combobox.Root
      items={SLUGS}
      multiple
      value={value}
      itemToStringLabel={labelOf}
      onValueChange={(next: string[]) => onChange(next)}
      onInputValueChange={(_v, details) => {
        // keep the typed search for the next pick
        if (details.isItemPress) details.cancel();
      }}
    >
      <Combobox.Trigger
        ref={trigger}
        aria-label={triggerLabel(value.length)}
        className={cn(TRIGGER, value.length > 0 && FILTER_PILL_ON)}
      >
        <TriggerFace value={value} />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} align="start" className="z-[210]">
          <Combobox.Popup className="w-[min(300px,calc(100vw-32px))] rounded-[14px] border border-edge2 bg-panel shadow-menu outline-none">
            <div className="relative border-b border-white/10 p-1.5">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/40"
                aria-hidden="true"
              />
              <Combobox.Input
                aria-label="Search categories"
                placeholder="Search categories"
                className="h-9 w-full rounded-[9px] border-0 bg-white/[.04] pl-8 pr-2 text-[13px] text-white outline-none placeholder:text-white/30"
              />
            </div>
            <Combobox.Empty className="small dim empty:hidden px-3 py-2.5">
              No category matches.
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(var(--available-height),340px)] overflow-y-auto p-1.5">
              {(s: string) => (
                <Combobox.Item
                  key={s}
                  value={s}
                  className="flex min-h-[38px] cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-2.5 font-inter-tight text-[13.5px] text-soft outline-none data-[highlighted]:bg-white/[.06] data-[highlighted]:text-white"
                >
                  <CategoryDot slug={s} />
                  <span className="flex-1">{labelOf(s)}</span>
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
