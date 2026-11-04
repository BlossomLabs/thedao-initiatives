import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useRef } from "react";
import { Select, SelectContent, SelectItem } from "~/components/ui/Select";
import { type BoardStatus, STATUS_LABELS } from "~/lib/board-view";
import { useTakeFocus } from "~/lib/focus-handover";
import { STATUS_FOCUS_KEY, StatusFace, statusPill } from "./faces";
import FundingGlyph from "./FundingGlyph";

const ITEMS: { value: BoardStatus; label: string }[] = [
  { value: "all", label: "Any funding status" },
  { value: "open", label: STATUS_LABELS.open },
  { value: "qualified", label: STATUS_LABELS.qualified },
  { value: "funded", label: STATUS_LABELS.funded },
];

/** The Funding pill: its ring shows the status it filters by, like the funding bar. */
export default function StatusSelect(
  { value, vote, onChange }: {
    value: BoardStatus;
    /** Offer Qualified for the vote (the vote display is on). */
    vote?: boolean;
    onChange: (s: BoardStatus) => void;
  },
) {
  const items = vote ? ITEMS : ITEMS.filter((s) => s.value !== "qualified");
  const trigger = useRef<HTMLButtonElement>(null);
  useTakeFocus(STATUS_FOCUS_KEY, trigger);
  return (
    <Select value={value} items={items} onValueChange={(v) => v && onChange(v as BoardStatus)}>
      <SelectPrimitive.Trigger
        ref={trigger}
        aria-label="Funding status"
        className={statusPill(value)}
      >
        <StatusFace value={value} />
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
