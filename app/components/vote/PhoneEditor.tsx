import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";
import { type Tier, tierName } from "../../../shared/vote/ballot";
import type { BallotItem, PhoneParts } from "./TierBallot";

/**
 * The ballot editor on a phone: the ballot box pinned at the top, then one list in tier
 * sections (S-Tier, A-Tier, B-Tier, then the initiatives not ranked yet, with the search),
 * and a bar at the bottom with the round's next deadline and Send. A tap on an initiative
 * opens its card (PhoneCard); the deadline and Send each open a sheet.
 */
export default function PhoneEditor(
  {
    id,
    parts,
    notice,
    aside,
    actions,
    tierRows,
    row,
    unranked,
    catFilter,
    searchBox,
    skippedBlock,
    tools,
    announce,
    card,
  }: {
    id: string;
    parts: PhoneParts;
    notice?: React.ReactNode;
    aside?: React.ReactNode;
    /** The send panel (BallotStatus): in the send sheet. */
    actions?: React.ReactNode;
    tierRows: {
      tier: Tier;
      grade: string;
      label: string;
      locked: boolean;
      items: BallotItem[];
      /** A settled tier's note about its picks that weren't funded. */
      note?: string;
    }[];
    row: (i: BallotItem) => React.ReactNode;
    unranked: { shown: BallotItem[]; total: number; filtered: boolean; empty: string };
    catFilter: React.ReactNode;
    searchBox: React.ReactNode;
    skippedBlock: React.ReactNode;
    tools: React.ReactNode;
    announce: string;
    card?: React.ReactNode;
  },
) {
  const [sheet, setSheet] = useState<"round" | "send">();
  const send = parts.send;
  return (
    <div>
      <div className="sticky top-[57px] z-20 -mx-6 mb-2 border-b border-white/10 bg-panel/95 px-4 py-3 backdrop-blur">
        {parts.head}
      </div>
      <div className="flex items-center justify-end gap-2 text-[12px]">{tools}</div>
      {notice && <div className="mt-4">{notice}</div>}
      {aside && <div className="mt-4">{aside}</div>}

      {tierRows.map((t) => (
        <section key={t.tier} aria-labelledby={`${id}-p${t.tier}`} className="mt-5">
          <div className="flex items-baseline gap-2 px-0.5 pb-2">
            <h2
              id={`${id}-p${t.tier}`}
              className="m-0 font-inter-tight text-[15px] font-bold text-[#8fd18d]"
            >
              {tierName(t.tier)}
            </h2>
            <span className="text-[13px] text-white/60">{t.label}</span>
            {t.locked && (
              <span className="text-[11px] uppercase tracking-[.08em] text-vote">Settled</span>
            )}
            <span className="ml-auto text-[12.5px] text-white/50 tnum">
              {t.items.length} {t.items.length === 1 ? "initiative" : "initiatives"}
            </span>
          </div>
          {t.note && (
            <p className="m-0 mb-2 px-0.5 text-[12.5px] leading-snug text-vote">{t.note}</p>
          )}
          {t.items.length
            ? <ul className="space-y-1.5" aria-label={tierName(t.tier)}>{t.items.map(row)}</ul>
            : (
              <p className="m-0 rounded-xl border border-dashed border-white/20 p-3.5 text-center text-[13px] text-white/55">
                Nothing in {tierName(t.tier)} yet. Tap an initiative to place it.
              </p>
            )}
        </section>
      ))}

      <section aria-labelledby={`${id}-pu`} className="mt-6">
        <div className="flex min-h-7 items-center gap-2 px-0.5 pb-2">
          <h2 id={`${id}-pu`} className="m-0 font-inter-tight text-[15px] font-bold text-white">
            Not ranked yet
          </h2>
          <span className="whitespace-nowrap text-[12.5px] text-white/50 tnum">
            {unranked.filtered ? `${unranked.shown.length} of ` : ""}
            {unranked.total}
          </span>
          {catFilter}
        </div>
        {searchBox}
        {unranked.shown.length > 0
          ? <ul className="space-y-1.5" aria-label="Not ranked yet">{unranked.shown.map(row)}</ul>
          : <p className="px-1 py-6 text-center text-[13px] text-white/45">{unranked.empty}</p>}
        {skippedBlock}
      </section>

      {
        // Pinned to the bottom, both sides of the screen: the next deadline, and Send.
      }
      <div
        data-phone-send-bar=""
        className="sticky bottom-0 z-10 -mx-6 mt-4 flex items-center gap-3 border-t border-white/10 bg-panel-deep/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"
      >
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSheet("round")}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {parts.round}
        </button>
        {send && (
          <button
            type="button"
            aria-haspopup={send.ready ? "dialog" : undefined}
            aria-disabled={!send.ready || undefined}
            onClick={() => (send.ready ? setSheet("send") : parts.onBlocked?.())}
            className={cn(
              "h-12 flex-none rounded-xl px-[18px] font-inter-tight text-[15px] font-semibold",
              send.ready ? "bg-[#e5484d] text-white" : "bg-white/[.12] text-white/55",
            )}
          >
            {send.label}
          </button>
        )}
      </div>

      {sheet === "round" && (
        <Sheet label="Where the round is" onClose={() => setSheet(undefined)}>
          {parts.roundSheet}
        </Sheet>
      )}
      {sheet === "send" && send && (
        <Sheet
          label="Send my ballot"
          onClose={() => setSheet(undefined)}
        >
          {send.summary}
          {actions}
        </Sheet>
      )}
      {card}
      <p aria-live="polite" className="sr-only">{announce}</p>
    </div>
  );
}

/** A sheet rising from the bottom over a dimmed page; the dim, the x or Escape close it. */
export function Sheet(
  { label, onClose, children }: {
    label: string;
    onClose: () => void;
    children: React.ReactNode;
  },
) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLElement>("[data-phone-sheet] [data-sheet-close]")
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[190]" data-phone-sheet="">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(8,18,28,.6)] motion-safe:animate-in motion-safe:fade-in"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[20px] bg-panel-modal px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(0,0,0,.35)] motion-safe:animate-in motion-safe:slide-in-from-bottom-10"
      >
        <div aria-hidden="true" className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/30" />
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="m-0 font-inter-tight text-[18px] font-bold text-white">
            {label}
          </h2>
          <button
            type="button"
            data-sheet-close=""
            aria-label="Close"
            onClick={onClose}
            className="-mr-2.5 grid size-11 place-items-center rounded-lg text-white/70 hover:bg-white/10"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-2 space-y-3.5">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
