import CountUp from "~/components/text-animations/CountUp";
import Shimmer from "~/components/layout/Shimmer";

// Figma: 72px top, 11px kicker, 100px bold amount, 22px sub, 1052px rule 30px below.
/** `raised` is undefined until the board has loaded. The amount keeps its
 * place but stays invisible until then; once known it fades in while counting
 * up from 0 (CountUp animates a change of `to` from the number on screen). */
export default function Hero({ raised }: { raised?: number }) {
  const known = raised !== undefined;
  return (
    <section className="mx-auto max-w-[1100px] px-6 pb-2 pt-[72px] text-center max-[760px]:pt-28">
      <p className="kicker m-0">Ecosystem-funded security initiatives</p>
      <div
        className={`mt-3.5 font-inter-tight text-[clamp(40px,10vw,100px)] font-bold leading-none tracking-[-.04em] text-white tnum transition-opacity duration-700 motion-reduce:transition-none ${
          known ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!known}
      >
        $<CountUp
          to={Math.round(raised ?? 0)}
          from={0}
          duration={1.6}
          separator=","
          className="tnum"
        />
      </div>
      <p className="m-0 mt-2.5 font-inter-tight text-[clamp(17px,2.6vw,22px)] text-white/80">
        raised for <span className="text-dao-green">Ethereum security</span> initiatives
      </p>
      <Shimmer />
    </section>
  );
}
