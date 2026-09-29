import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { Select, SelectContent } from "~/components/ui/Select";
import type { BoardType } from "~/lib/board-view";
import { cn } from "~/lib/utils";
import { FILTER_PILL, FILTER_PILL_ON } from "./CategoryTrigger";
import TypeGlyph from "./TypeGlyph";

const LABELS: Record<BoardType, string> = { all: "All types", rfp: "RFPs", grant: "Grants" };
const ITEMS = (["all", "rfp", "grant"] as const).map((value) => ({ value, label: LABELS[value] }));

/** The type pill: all initiatives, RFPs or grants, each with its live count. */
export default function TypeSelect(
  { value, counts, onChange }: {
    value: BoardType;
    counts: Record<BoardType, number>;
    onChange: (t: BoardType) => void;
  },
) {
  return (
    <Select value={value} items={ITEMS} onValueChange={(v) => v && onChange(v as BoardType)}>
      <SelectPrimitive.Trigger
        aria-label="Type"
        className={cn(FILTER_PILL, value !== "all" && FILTER_PILL_ON)}
      >
        <TypeGlyph type={value} />
        <span>
          {LABELS[value]} <span className="tnum text-white/50">{counts[value]}</span>
        </span>
        <ChevronDown className="size-3.5 text-white/45" aria-hidden="true" />
      </SelectPrimitive.Trigger>
      <SelectContent>
        {ITEMS.map((t) => (
          // Like the Category menu: the check has its own slot, so the count never moves.
          <SelectPrimitive.Item
            key={t.value}
            value={t.value}
            className="flex w-full cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-3 py-2.5 font-inter-tight text-[14px] text-soft outline-none data-[highlighted]:bg-[rgba(92,183,90,.08)] data-[highlighted]:text-dao-green data-[selected]:text-dao-green"
          >
            <TypeGlyph type={t.value} />
            <SelectPrimitive.ItemText className="flex-1 whitespace-nowrap">
              {t.label}
            </SelectPrimitive.ItemText>
            <span className="flex w-4 justify-center">
              <SelectPrimitive.ItemIndicator>
                <Check className="size-4" aria-hidden="true" />
              </SelectPrimitive.ItemIndicator>
            </span>
            <span className="w-5 text-right tnum text-white/40">{counts[t.value]}</span>
          </SelectPrimitive.Item>
        ))}
      </SelectContent>
    </Select>
  );
}
