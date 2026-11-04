import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check } from "lucide-react";
import { useRef } from "react";
import { Select, SelectContent } from "~/components/ui/Select";
import type { BoardType } from "~/lib/board-view";
import { useTakeFocus } from "~/lib/focus-handover";
import { TYPE_FOCUS_KEY, TYPE_LABELS, TypeFace, typePill } from "./faces";
import TypeGlyph from "./TypeGlyph";

const ITEMS = (["all", "rfp", "grant"] as const).map((value) => ({
  value,
  label: TYPE_LABELS[value],
}));

/** The type pill: all initiatives, RFPs or grants, each with its live count. */
export default function TypeSelect(
  { value, counts, onChange }: {
    value: BoardType;
    counts: Record<BoardType, number>;
    onChange: (t: BoardType) => void;
  },
) {
  const trigger = useRef<HTMLButtonElement>(null);
  useTakeFocus(TYPE_FOCUS_KEY, trigger);
  return (
    <Select value={value} items={ITEMS} onValueChange={(v) => v && onChange(v as BoardType)}>
      <SelectPrimitive.Trigger ref={trigger} aria-label="Type" className={typePill(value)}>
        <TypeFace value={value} count={counts[value]} />
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
