import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Drawer } from "@base-ui/react/drawer";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check, Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useTakeFocus } from "~/lib/focus-handover";
import { SHEET_FOCUS_KEY, sheetTriggerClass, SheetTriggerFace } from "./SheetTrigger";
import { Button } from "~/components/ui/Button";
import CategoryDot from "~/components/ui/CategoryDot";
import type { Card } from "~/lib/api-types";
import { applyView, type BoardStatus, type BoardView, facetCounts } from "~/lib/board-view";
import { CATEGORIES } from "~/lib/categories";
import { plural } from "~/lib/format";

type Picks = Pick<BoardView, "cats" | "status">;

const STATUSES: [BoardStatus, string][] = [
  ["all", "Any funding status"],
  ["open", "Open for funding"],
  ["funded", "Fully funded"],
];

/**
 * Phones: Filters (N) opens a bottom sheet with an inline category search and
 * list, and the funding status. Picks are provisional until Show N initiatives;
 * closing discards them and Reset clears them. The footer sits above the safe
 * area, and the list scrolls between the fixed header and footer.
 */
export default function FilterSheet(
  { cards, view, onApply }: { cards: Card[]; view: BoardView; onApply: (p: Picks) => void },
) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useTakeFocus(SHEET_FOCUS_KEY, trigger);
  const [picks, setPicks] = useState<Picks>({ cats: view.cats, status: view.status });
  const [q, setQ] = useState("");
  const ids = useId();
  const next = useMemo(() => ({ ...view, ...picks }), [view, picks]);
  const shown = useMemo(() => applyView(cards, next).length, [cards, next]);
  const counts = useMemo(() => facetCounts(cards, next).cats, [cards, next]);
  const query = q.trim().toLowerCase();
  const list = CATEGORIES.filter((c) => c.label.toLowerCase().includes(query));

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        // Each opening starts from what the board shows; closing drops the rest.
        if (o) {
          setPicks({ cats: view.cats, status: view.status });
          setQ("");
        }
        setOpen(o);
      }}
    >
      <Drawer.Trigger ref={trigger} className={sheetTriggerClass(view)}>
        <SheetTriggerFace view={view} />
      </Drawer.Trigger>
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className="fixed inset-0 z-[200] bg-[rgba(15,30,44,.62)] backdrop-blur-[4px] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Drawer.Viewport className="fixed inset-0 z-[205] flex items-end justify-center">
            <Drawer.Popup className="flex max-h-[85dvh] w-full flex-col rounded-t-[18px] border border-b-0 border-edge2 bg-panel-modal shadow-modal outline-none [transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)]">
              <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
                <Drawer.Title className="m-0 font-inter-tight text-[18px] font-medium text-white">
                  Filters
                </Drawer.Title>
                <Drawer.Close
                  aria-label="Close"
                  className="grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-white/70 hover:text-white"
                >
                  <X className="size-5" aria-hidden="true" />
                </Drawer.Close>
              </div>
              <Drawer.Content className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
                <label htmlFor={`${ids}-q`} className="k mb-2 block">Category</label>
                <div className="relative mb-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40"
                    aria-hidden="true"
                  />
                  <input
                    id={`${ids}-q`}
                    type="search"
                    aria-label="Search categories"
                    placeholder="Search categories"
                    autoComplete="off"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="field min-h-[44px] pl-9 text-[16px]"
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
                        className="grid size-5 flex-none cursor-pointer place-items-center rounded-[5px] border border-white/25 bg-transparent p-0 data-[checked]:border-dao-green data-[checked]:bg-dao-green"
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
                <span className="k mb-1 mt-5 block" id={`${ids}-status`}>Funding status</span>
                <RadioGroup
                  value={picks.status}
                  onValueChange={(status) =>
                    setPicks((p) => ({ ...p, status: status as BoardStatus }))}
                  aria-labelledby={`${ids}-status`}
                  className="flex flex-col"
                >
                  {STATUSES.map(([v, label]) => (
                    <label
                      key={v}
                      className="flex min-h-[44px] cursor-pointer items-center gap-3 font-inter-tight text-[14px] text-soft"
                    >
                      <Radio.Root
                        value={v}
                        className="grid size-5 flex-none cursor-pointer place-items-center rounded-full border border-white/25 bg-transparent p-0 data-[checked]:border-dao-green"
                      >
                        <Radio.Indicator className="size-2.5 rounded-full bg-dao-green" />
                      </Radio.Root>
                      {label}
                    </label>
                  ))}
                </RadioGroup>
              </Drawer.Content>
              <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
                <Button variant="ghost" onClick={() => setPicks({ cats: [], status: "all" })}>
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
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}
