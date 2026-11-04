import { useEffect, useRef, useState } from "react";
import CountUp from "~/components/text-animations/CountUp";
import Shimmer from "~/components/layout/Shimmer";
import { HERO_COUNT_SCRIPT } from "~/lib/hero-count";

// Figma: 72px top, 11px kicker, 100px bold amount, 22px sub, 1052px rule 30px below.
/** `raised` is undefined until the board has loaded. The amount keeps its
 * place but stays invisible until then; once known it fades in while counting
 * up from `countFrom` (CountUp animates a change of `to` from the number on
 * screen). With `earlyCount` (the homepage) an inline script counts in an
 * overlay from first paint (lib/hero-count.ts); the amount then takes over
 * from the overlay's number at once, without the fade. */
export default function Hero(
  { raised, kicker, sub, children, countFrom = 0, earlyCount = false }: {
    raised?: number;
    /** Where the count starts (the homepage: HERO_COUNT_FROM). */
    countFrom?: number;
    /** Count from first paint, before the app loads (the prerendered homepage only). */
    earlyCount?: boolean;
    /** The DevCon projector's own kicker and line under the amount (defaults: the homepage's). */
    kicker?: React.ReactNode;
    sub?: React.ReactNode;
    /** Below the line, before the shimmer rule. */
    children?: React.ReactNode;
  },
) {
  const known = raised !== undefined;
  // The prerendered page's overlay, if its script ran (never on the server).
  const [early] = useState(() => earlyCount ? globalThis.__heroCount : undefined);
  const start = useRef<number | null>(null);
  if (known && start.current === null) start.current = early ? early.value() : countFrom;
  // After CountUp has written its first number (child effects run first).
  useEffect(() => {
    if (known) early?.stop();
  }, [known, early]);
  return (
    <section className="mx-auto max-w-[1100px] px-6 pb-2 pt-[72px] text-center max-[760px]:pt-28">
      <p className="kicker m-0">{kicker ?? "Ecosystem-funded security initiatives"}</p>
      <div
        className={`mt-3.5 font-inter-tight text-[clamp(40px,10vw,100px)] font-bold leading-none tracking-[-.04em] text-white tnum ${
          // Taking over from the overlay: already on screen, so no fade.
          known && early ? "" : "transition-opacity duration-700 motion-reduce:transition-none "}${
          known ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!known}
      >
        $<CountUp
          // Mounted afresh once the amount is known, so it starts from `start`.
          key={known ? "known" : "waiting"}
          to={Math.round(raised ?? 0)}
          from={start.current ?? countFrom}
          duration={early ? 1 : 1.6}
          separator=","
          className="tnum"
        />
      </div>
      {earlyCount && <script dangerouslySetInnerHTML={{ __html: HERO_COUNT_SCRIPT }} />}
      <p className="m-0 mt-2.5 font-inter-tight text-[clamp(17px,2.6vw,22px)] text-white/80">
        {sub ?? (
          <>
            raised for <span className="text-dao-green">Ethereum security</span> initiatives
          </>
        )}
      </p>
      {children}
      <Shimmer />
    </section>
  );
}
