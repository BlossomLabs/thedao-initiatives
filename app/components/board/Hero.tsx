import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import CountUp from "~/components/text-animations/CountUp";
import Shimmer from "~/components/layout/Shimmer";

// Figma: 72px top, 11px kicker, 100px bold amount, 22px sub, 1052px rule 30px below.
/** `raised` is undefined until the board has loaded. The amount keeps its
 * place but stays invisible until then; once known it fades in while counting
 * up from `countFrom` (CountUp animates a change of `to` from the number on
 * screen). With `countEarly` (the homepage) it shows as soon as the app is up
 * instead: from `countFrom` it creeps toward 10% more while the board loads,
 * then counts to the amount in a second. Reduced motion: shown once known. */
export default function Hero(
  { raised, kicker, sub, children, countFrom = 0, countEarly = false }: {
    raised?: number;
    /** Where the count starts (the homepage: HERO_COUNT_FROM). */
    countFrom?: number;
    /** Count while the amount loads (the homepage). */
    countEarly?: boolean;
    /** the vote results' own kicker and line under the amount (defaults: the homepage's). */
    kicker?: React.ReactNode;
    sub?: React.ReactNode;
    /** Below the line, before the shimmer rule. */
    children?: React.ReactNode;
  },
) {
  const known = raised !== undefined;
  const reduce = useReducedMotion();
  // From the first effect on, not the first render: that one matches the
  // prerendered page (the hydration), where nothing counts.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const waiting = countEarly && mounted && !reduce && !known;
  const shown = known || waiting;
  return (
    <section className="mx-auto max-w-[1100px] px-6 pb-2 pt-[72px] text-center max-[760px]:pt-28">
      <p className="kicker m-0">{kicker ?? "Ecosystem-funded security initiatives"}</p>
      <div
        className={`mt-3.5 font-inter-tight text-[clamp(40px,10vw,100px)] font-bold leading-none tracking-[-.04em] text-white tnum transition-opacity duration-700 motion-reduce:transition-none ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!known}
      >
        $<CountUp
          to={known ? Math.round(raised) : waiting ? Math.round(countFrom * 1.1) : countFrom}
          from={countFrom}
          // Slow while it waits for the amount; once known, the last stretch.
          duration={waiting ? 8 : countEarly ? 1 : 1.6}
          startWhen={shown}
          separator=","
          className="tnum"
        />
      </div>
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
