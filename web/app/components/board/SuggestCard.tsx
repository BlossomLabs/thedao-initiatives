import { Link } from "react-router";

// Figma: 220px dashed card, 48px plus circle, 18px title, 13px sub.
export default function SuggestCard({ style }: { style?: React.CSSProperties }) {
  return (
    <Link
      to="/submit"
      style={style}
      className="card group flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-1.5 border-dashed border-white/15 bg-white/[.03] text-center text-soft no-underline hover:border-[rgba(92,183,90,.55)] hover:no-underline hover:shadow-[0_0_30px_rgba(92,183,90,.1)] motion-safe:animate-fade-in-up"
    >
      <span
        className="flex size-12 items-center justify-center rounded-full border border-[rgba(0,255,136,.3)] bg-[rgba(0,255,136,.12)] font-inter-tight text-[30px] font-light leading-none text-dao-green transition-[transform,background] duration-150 group-hover:scale-[1.08] group-hover:bg-[rgba(92,183,90,.16)]"
        aria-hidden="true"
      >
        +
      </span>
      <span className="mt-1.5 font-inter-tight text-[18px] font-medium text-white group-hover:text-dao-green">
        Suggest an initiative
      </span>
      <span className="max-w-[260px] text-[13px] text-muted">
        Know something the ecosystem should fund? Pitch it.
      </span>
    </Link>
  );
}
