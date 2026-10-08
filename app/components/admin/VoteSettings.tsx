import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@base-ui/react/switch";
import { Slider } from "@base-ui/react/slider";
import { DEFAULT_VOTE, type VoteSettings as Settings } from "@shared/vote";
import { Button } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { useAdminApi } from "~/hooks/use-admin-api";
import { api, errorMessage } from "~/lib/api";
import { boardKey } from "~/hooks/use-board";
import { siteSettingsKey } from "~/hooks/use-site-settings";
import { cn } from "~/lib/utils";

export const voteSettingsKey = ["admin", "vote-settings"] as const;

/** The vote settings as saved (the defaults until an admin saves). */
export const useVoteSettings = () =>
  useQuery({
    queryKey: voteSettingsKey,
    queryFn: ({ signal }) => api<Settings>("/api/admin/vote-settings", { signal }),
  });

const CARD = "rounded-2xl border border-edge bg-card px-[18px] py-4";
const TITLE = "block font-inter-tight text-[14px] font-semibold";
const HINT = "block text-[12px] text-muted";

const grouped = (n: number) => n.toLocaleString("en-US");
const parseUsd = (s: string) => Number(s.replace(/[\s,$]/g, ""));

/**
 * The Vote page: whether the site shows what it takes to qualify for the
 * vote (saved at once), that share of the goal on a slider, and the maximum TheDAO
 * distributes per initiative (saved together).
 */
export default function VoteSettings() {
  const adminApi = useAdminApi();
  const qc = useQueryClient();
  const ids = useId();
  const { data } = useVoteSettings();
  const [floorPct, setFloorPct] = useState(DEFAULT_VOTE.floorPct);
  const [max, setMax] = useState(grouped(DEFAULT_VOTE.capUsd));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"switch" | "numbers" | null>(null);
  useEffect(() => {
    if (data) {
      setFloorPct(data.floorPct);
      setMax(grouped(data.capUsd));
    }
  }, [data]);

  const maxUsd = parseUsd(max);
  const maxBad = max.trim() === "" || !Number.isFinite(maxUsd) || maxUsd < 0;
  const dirty = Boolean(data) && (floorPct !== data!.floorPct || maxUsd !== data!.capUsd);
  const on = Boolean(data?.show);

  const save = async (next: Settings, what: "switch" | "numbers") => {
    setBusy(what);
    setMsg(null);
    try {
      await adminApi("/api/admin/vote-settings", { json: next });
      qc.setQueryData(voteSettingsKey, next);
      setMsg({
        ok: true,
        text: what === "switch"
          ? next.show ? "On the site within a minute." : "Hidden from the site within a minute."
          : "Saved.",
      });
      for (const k of [boardKey, siteSettingsKey]) void qc.invalidateQueries({ queryKey: k });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, "Not saved. Try again.") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-3">
      {/* Shown on the site: saved at once. */}
      <section className={cn(CARD, "flex flex-wrap items-center gap-3")}>
        <div className="min-w-[220px] flex-1">
          <b className={TITLE}>Show what it takes to qualify on the site</b>
          <small className={HINT}>
            A mark on every funding bar where an initiative qualifies for the vote, the Qualified
            for the vote filter, and a line on each initiative page.
          </small>
        </div>
        {/* Not a <label>: Base UI would name the switch after it ("Hidden"), not its aria-label. */}
        <div className="flex flex-none items-center gap-2.5 font-inter-tight text-[13px]">
          <span className={on ? "text-dao-green" : "text-muted"} aria-hidden="true">
            {on ? "On the site" : "Hidden"}
          </span>
          <Switch.Root
            checked={on}
            disabled={!data || busy !== null}
            onCheckedChange={(show) => data && void save({ ...data, show }, "switch")}
            aria-label="Show what it takes to qualify on the site"
            className="relative h-5 w-9 flex-none cursor-pointer rounded-full border-0 bg-white/15 p-0 transition-colors duration-150 data-[checked]:bg-dao-green data-[disabled]:cursor-default data-[disabled]:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dao-bright"
          >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-150 data-[checked]:translate-x-[18px]" />
          </Switch.Root>
        </div>
      </section>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (data && dirty && !maxBad) {
            void save({ ...data, floorPct, capUsd: Math.round(maxUsd) }, "numbers");
          }
        }}
      >
        {/* What it takes to qualify: a slider, its value large. */}
        <section className={CARD} aria-labelledby={`${ids}-goal`}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-[220px] flex-1">
              <b id={`${ids}-goal`} className={TITLE}>To qualify</b>
              <small className={HINT}>
                The share of its goal an initiative raises to qualify for TheDAO's vote.
              </small>
            </div>
            <span className="flex items-baseline gap-3">
              {floorPct !== DEFAULT_VOTE.floorPct && (
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 font-inter-tight text-[12px] text-muted underline decoration-white/25 underline-offset-2 hover:text-white"
                  onClick={() => setFloorPct(DEFAULT_VOTE.floorPct)}
                >
                  Reset to {DEFAULT_VOTE.floorPct}%
                </button>
              )}
              <output
                htmlFor={`${ids}-slider`}
                className="font-inter-tight text-[28px] font-semibold leading-none tnum text-white"
              >
                {floorPct}
                <span className="ml-0.5 text-[16px] font-normal text-muted">%</span>
              </output>
            </span>
          </div>

          <Slider.Root
            id={`${ids}-slider`}
            value={floorPct}
            min={1}
            max={100}
            step={1}
            onValueChange={(v) => setFloorPct(v as number)}
            aria-labelledby={`${ids}-goal`}
            className="mt-4"
          >
            <Slider.Control className="flex h-6 cursor-pointer touch-none items-center select-none">
              <Slider.Track className="relative h-1.5 w-full rounded-full bg-white/[.12]">
                <Slider.Indicator className="rounded-full bg-gradient-to-r from-dao-green to-dao-bright" />
                <Slider.Thumb
                  aria-label="To qualify, as a percentage of an initiative's goal"
                  className="size-[18px] rounded-full border-2 border-dao-green bg-white shadow-[0_2px_8px_rgba(0,0,0,.35)] outline-none focus-visible:ring-2 focus-visible:ring-dao-bright focus-visible:ring-offset-2 focus-visible:ring-offset-[#24506f]"
                />
              </Slider.Track>
            </Slider.Control>
          </Slider.Root>
          <div className="mt-1 flex justify-between font-inter-tight text-[11px] text-white/35 tnum">
            <span>1%</span>
            <span>100%</span>
          </div>
        </section>

        {/* What TheDAO distributes at most to one initiative. */}
        <section className={cn(CARD, "flex flex-wrap items-center gap-3")}>
          <div className="min-w-[220px] flex-1">
            <label htmlFor={`${ids}-max`} className={TITLE}>
              Maximum distributed per initiative
            </label>
            <small
              id={`${ids}-max-hint`}
              className={cn(HINT, maxBad && "text-[#ffb4b1]")}
            >
              {maxBad
                ? "Use an amount of $0 or more."
                : "The most TheDAO distributes to one initiative. A larger goal qualifies only once what is left to raise is this much or less."}
            </small>
          </div>
          {/* The $ sits inside the field, as an adornment (shadcn's input group). */}
          <span className="relative flex-none">
            <span
              className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-inter-tight text-[14px] text-muted"
              aria-hidden="true"
            >
              $
            </span>
            <input
              id={`${ids}-max`}
              className="w-[132px] rounded-lg border border-edge2 bg-white/5 py-1.5 pl-6 pr-2.5 text-right font-inter-tight text-[14px] tnum text-white outline-none focus:border-[rgba(92,183,90,.6)] aria-[invalid=true]:border-dao-red"
              inputMode="numeric"
              aria-invalid={maxBad}
              aria-describedby={`${ids}-max-hint`}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              onBlur={() => !maxBad && setMax(grouped(Math.round(maxUsd)))}
            />
          </span>
        </section>

        <div className="flex min-h-[34px] flex-wrap items-center gap-3">
          <Button
            sm
            type="submit"
            loading={busy === "numbers"}
            disabled={!dirty || maxBad || busy !== null}
          >
            Save changes
          </Button>
          {msg && <Status kind={msg.ok ? "ok" : "err"}>{msg.text}</Status>}
        </div>
      </form>
    </div>
  );
}
