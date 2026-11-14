import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";

/** What the combobox needs from an initiative. */
export type ComboboxInitiative = { id: string; title: string };

/**
 * Search initiatives by name and pick one: the support widget's pledge form
 * and the admin dashboard use the same field. Controlled: the caller keeps
 * the picked initiative and the typed text.
 */
export default function InitiativeCombobox<T extends ComboboxInitiative>({
  id,
  items,
  value,
  onValueChange,
  inputValue,
  onInputValueChange,
  inputRef,
  disabled,
  required,
  placeholder = "Search by initiative name…",
  popupZ = "z-[210]",
  popupProps,
  itemExtra,
}: {
  id: string;
  items: T[];
  value: T | null;
  onValueChange: (value: T | null) => void;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  /** Stacking class of the popup; the support widget's sits over its own panel. */
  popupZ?: string;
  /** Extra attributes on the popup (the support widget marks it as its own). */
  popupProps?: React.ComponentProps<typeof Combobox.Popup>;
  /** Shown after the title in each option, e.g. a status. */
  itemExtra?: (item: T) => React.ReactNode;
}) {
  return (
    <Combobox.Root
      items={items}
      value={value}
      onValueChange={onValueChange}
      inputValue={inputValue}
      onInputValueChange={onInputValueChange}
      itemToStringLabel={(i) => i.title}
      itemToStringValue={(i) => i.id}
      isItemEqualToValue={(a, b) => a.id === b.id}
      disabled={disabled}
      autoHighlight
    >
      <div className="relative">
        <Combobox.Input
          id={id}
          ref={inputRef}
          required={required}
          placeholder={placeholder}
          className="field w-full py-2.5 pr-9 text-[13.5px]"
        />
        <Combobox.Trigger
          aria-label="Show initiatives"
          className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-white/50"
        >
          <ChevronDown className="size-4" aria-hidden />
        </Combobox.Trigger>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} className={popupZ}>
          <Combobox.Popup
            {...popupProps}
            className="w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] rounded-[14px] border border-edge2 bg-panel shadow-menu outline-none"
          >
            <Combobox.Empty className="empty:hidden px-3 py-2.5 text-[13px] text-muted">
              No initiatives found.
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(var(--available-height),240px)] overflow-y-auto p-1.5">
              {(i: T) => (
                <Combobox.Item
                  key={i.id}
                  value={i}
                  className="flex cursor-pointer items-center gap-2 rounded-[9px] px-2.5 py-2 text-[13px] text-soft outline-none data-[highlighted]:bg-white/[.06] data-[highlighted]:text-white"
                >
                  <span className="min-w-0 flex-1">{i.title}</span>
                  {itemExtra?.(i)}
                  <Combobox.ItemIndicator>
                    <Check className="size-4 text-dao-green" aria-hidden />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
