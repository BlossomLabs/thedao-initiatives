import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";
import Pop, { PopBox } from "./Pop";

/**
 * Modal in the MVP's nickname-dialog look (solid navy panel over a blurred
 * overlay). Hand-rolled like thedao-frontend's ProjectModal: Escape and
 * backdrop close it, focus moves inside, body scroll is locked.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  focusField = true,
  icon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Focus the first field on open (the default). Off, the panel itself takes focus:
   * for a dialog whose field isn't the first thing to do (a paste box at its end). */
  focusField?: boolean;
  /** Before the title (decorative: the title alone names the dialog). */
  icon?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // Callers often pass an inline closure; reading it through a ref keeps the
  // open effect from re-running (and re-focusing) on every render.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChangeRef.current(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // A field first; the close button in the header is the last resort. Or, asked not
    // to, the panel: focus is in the dialog, nothing in it is active.
    const first = !focusField ? panel.current : panel.current?.querySelector<HTMLElement>(
      "input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
    ) ?? panel.current?.querySelector<HTMLElement>("button:not([aria-label='Close']),[tabindex]") ??
      panel.current?.querySelector<HTMLElement>("button");
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <Pop
      show={open}
      from="fade"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(15,30,44,.62)] p-5 backdrop-blur-[4px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <PopBox
        from="zoom"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "flex w-[min(420px,100%)] flex-col gap-3 rounded-[18px] border border-edge2 bg-panel-modal p-[22px] shadow-modal outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            id={titleId}
            className="m-0 flex items-center gap-2 font-inter-tight text-[18px] font-medium text-white"
          >
            {icon && <span aria-hidden="true" className="flex flex-none text-white/80">{icon}
            </span>}
            {title}
          </h3>
          <button
            type="button"
            className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </button>
        </div>
        {description && (
          <p id={descId} className="m-0 text-[12.5px] leading-[1.5] text-muted">{description}</p>
        )}
        {children}
      </PopBox>
    </Pop>,
    document.body,
  );
}
