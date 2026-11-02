import { useId, useState } from "react";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/utils";
import type { Tier } from "../../../shared/devcon/ballot";

/** Ported from blossomlabs.eth's budgeting TierList: tap a proposal, then
 * "Move here" in a tier (or drag it on a desktop). Same tier = equal priority. */
export const TIER_LABELS: { tier: Tier; grade: string; label: string }[] = [
  { tier: "S", grade: "S", label: "Must fund" },
  { tier: "A", grade: "A", label: "Should fund" },
  { tier: "B", grade: "B", label: "Nice to have" },
];

type Where = Tier | "unplaced";

export default function TierBallot({ items, tiers, disabled, onChange }: {
  items: { slug: string; title: string }[];
  tiers: Partial<Record<string, Tier>>;
  disabled: boolean;
  onChange: (slug: string, tier: Tier | undefined) => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const [announce, setAnnounce] = useState("");
  const where = (slug: string): Where => tiers[slug] ?? "unplaced";
  const labelOf = (w: Where) => TIER_LABELS.find((t) => t.tier === w)?.label ?? "Unplaced";
  const titleOf = (slug: string) => items.find((i) => i.slug === slug)?.title ?? slug;

  const move = (slug: string, dest: Where) => {
    setSelected(undefined);
    setDragging(undefined);
    if (where(slug) === dest) return;
    onChange(slug, dest === "unplaced" ? undefined : dest);
    setAnnounce(`${titleOf(slug)} moved to ${labelOf(dest)}.`);
  };

  const group = (dest: Where) => {
    const inHere = items.filter((i) => where(i.slug) === dest);
    const canMove = !disabled && selected !== undefined && where(selected) !== dest;
    return (
      <div
        className="space-y-1.5"
        onDragOver={(e) => {
          if (dragging) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging) move(dragging, dest);
        }}
      >
        {inHere.length === 0 && dest !== "unplaced" && (
          <p className="text-[13px] text-white/40">Tap a proposal below, then “Move here”.</p>
        )}
        <ul className="space-y-1.5" aria-label={labelOf(dest)}>
          {inHere.map((i) => (
            <li key={i.slug}>
              <button
                type="button"
                disabled={disabled}
                draggable={!disabled}
                aria-pressed={selected === i.slug}
                aria-describedby={`${id}-how`}
                onDragStart={() => {
                  setDragging(i.slug);
                  setSelected(i.slug);
                }}
                onDragEnd={() => setDragging(undefined)}
                onClick={() => setSelected(selected === i.slug ? undefined : i.slug)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[14px] leading-snug transition-colors",
                  selected === i.slug
                    ? "border-dao-green bg-dao-green/10 text-white"
                    : "border-white/10 bg-white/[.04] text-white/85 hover:border-white/25",
                  disabled && "opacity-60",
                )}
              >
                <span aria-hidden="true" className="text-white/40">
                  {selected === i.slug ? "✓" : "⠿"}
                </span>
                <span>{i.title}</span>
              </button>
            </li>
          ))}
        </ul>
        {canMove && (
          <Button
            sm
            className="w-full"
            aria-label={`Move here: ${labelOf(dest)}`}
            onClick={() => selected && move(selected, dest)}
          >
            Move here ↳
          </Button>
        )}
      </div>
    );
  };

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") setSelected(undefined);
      }}
    >
      <p id={`${id}-how`} className="sr-only">
        Select a proposal, then choose Move here in a tier. Escape cancels.
      </p>
      <div className="space-y-3">
        {TIER_LABELS.map((t) => (
          <section
            key={t.tier}
            aria-labelledby={`${id}-${t.tier}`}
            className="rounded-xl border border-white/10 bg-white/[.03] p-3"
          >
            <h3 id={`${id}-${t.tier}`} className="mb-2 flex items-baseline gap-2">
              <b className="font-inter-tight text-[18px] text-dao-green">{t.grade}</b>
              <span className="text-[14px] font-medium text-white">{t.label}</span>
              <span className="ml-auto text-[12px] text-white/40 tnum">
                {items.filter((i) => tiers[i.slug] === t.tier).length}
              </span>
            </h3>
            {group(t.tier)}
          </section>
        ))}
      </div>
      <section aria-labelledby={`${id}-u`} className="mt-6">
        <h3 id={`${id}-u`} className="mb-2 text-[14px] font-medium text-white/70">
          Not placed{" "}
          <span className="text-white/40 tnum">
            {items.filter((i) => !tiers[i.slug]).length}
          </span>
        </h3>
        <p className="mb-2 text-[12.5px] text-white/45">
          Anything you leave here gets none of your share.
        </p>
        {group("unplaced")}
      </section>
      <p aria-live="polite" className="sr-only">{announce}</p>
    </div>
  );
}
