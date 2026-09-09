import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("input,textarea,button,[tabindex]");
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(15,30,44,.62)] p-5 backdrop-blur-[4px] animate-in fade-in-0 duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "flex w-[min(420px,100%)] flex-col gap-3 rounded-[18px] border border-edge2 bg-panel-modal p-[22px] shadow-modal outline-none animate-in fade-in-0 zoom-in-95 duration-200",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id={titleId} className="m-0 font-inter-tight text-[18px] font-medium text-white">
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
      </div>
    </div>,
    document.body,
  );
}
