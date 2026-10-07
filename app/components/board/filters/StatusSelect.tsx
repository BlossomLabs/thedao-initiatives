import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem } from "~/components/ui/Select";
import { type BoardStatus, STATUS_LABELS } from "~/lib/board-view";
import { cn } from "~/lib/utils";
import { FILTER_PILL, FILTER_PILL_ON } from "./CategoryTrigger";
import FundingGlyph from "./FundingGlyph";

const ITEMS: { value: BoardStatus; label: string }[] = [
  { value: "all", label: "Any funding status" },
  { value: "open", label: STATUS_LABELS.open },
  { value: "first-goal", label: STATUS_LABELS["first-goal"] },
  { value: "funded", label: STATUS_LABELS.funded },
];

/** The Funding pill: its ring shows the status it filters by, like the funding bar. */
export default function StatusSelect(
  { value, vote, onChange }: {
    value: BoardStatus;
    /** Offer First goal reached (the vote display is on). */
    vote?: boolean;
    onChange: (s: BoardStatus) => void;
  },
) {
  const items = vote ? ITEMS : ITEMS.filter((s) => s.value !== "first-goal");
  return (
    <Select value={value} items={items} onValueChange={(v) => v && onChange(v as BoardStatus)}>
      <SelectPrimitive.Trigger
        aria-label="Funding status"
        className={cn(FILTER_PILL, value !== "all" && FILTER_PILL_ON)}
      >
        <FundingGlyph status={value} />
        <span>{value === "all" ? "Funding" : STATUS_LABELS[value]}</span>
        <ChevronDown className="size-3.5 text-white/45" aria-hidden="true" />
      </SelectPrimitive.Trigger>
      <SelectContent>
        {items.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            <span className="flex items-center gap-2.5">
              <FundingGlyph status={s.value} />
              {s.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
