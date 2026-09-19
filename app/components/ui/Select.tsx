import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Select in the site's input style: the trigger is a `.field`, the list is the
 * same panel as the wallet menu. Same building block and parts as shadcn's
 * Select (Base UI underneath), so `name`, `value`/`defaultValue`, `disabled`
 * and `required` go on the root and it still posts with a form.
 */
export const Select = SelectPrimitive.Root;

export function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group className={cn("flex flex-col", className)} {...props} />;
}

export function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn(
        "min-w-0 flex-1 truncate text-left data-[placeholder]:text-white/30",
        className,
      )}
      {...props}
    />
  );
}

export function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & { size?: "sm" | "default" }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "field flex cursor-pointer items-center justify-between gap-2 whitespace-nowrap data-[popup-open]:border-[rgba(92,183,90,.6)] data-[disabled]:cursor-default data-[disabled]:opacity-50",
        size === "sm" && "w-auto rounded-[10px] px-2.5 py-1.5 text-[12px]",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="flex flex-none text-white/50">
        <ChevronDown className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  ...props
}:
  & SelectPrimitive.Popup.Props
  & Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      {/* above the Dialog overlay (z-200), so a select inside a dialog still opens on top */}
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-[210]"
      >
        <SelectPrimitive.Popup
          className={cn(
            "relative min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-[14px] border border-edge2 bg-panel shadow-menu outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow className="absolute inset-x-0 top-0 z-10 flex items-center justify-center bg-panel py-0.5 text-white/50">
            <ChevronUp className="size-4" aria-hidden="true" />
          </SelectPrimitive.ScrollUpArrow>
          {/* the list scrolls, not the popup: Base UI only shows the scroll arrows that way */}
          <SelectPrimitive.List className="max-h-[min(var(--available-height),320px)] overflow-y-auto p-1.5">
            {children}
          </SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center bg-panel py-0.5 text-white/50">
            <ChevronDown className="size-4" aria-hidden="true" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      className={cn(
        "px-3 pb-1 pt-2 font-inter-tight text-[11px] uppercase tracking-[0.12em] text-dao-green",
        className,
      )}
      {...props}
    />
  );
}

export function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-3 py-2.5 font-inter-tight text-[14px] text-soft outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-[rgba(92,183,90,.08)] data-[highlighted]:text-dao-green data-[selected]:text-dao-green",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex-1 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="flex-none">
        <Check className="size-4" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      className={cn("pointer-events-none my-1.5 h-px bg-edge2", className)}
      {...props}
    />
  );
}
