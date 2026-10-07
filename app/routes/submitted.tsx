import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { confettiBurst } from "~/components/donate/Celebration";
import PageMain from "~/components/layout/PageMain";
import { LinkButton } from "~/components/ui/Button";
import Status from "~/components/ui/Status";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "Thank you", url: "/submit/thanks", noIndex: true });
}

export interface SubmittedState {
  title?: string;
  slug?: string;
  warnings?: { field: string; msg: string }[];
}

const rise = (i: number) => ({ "--i": i }) as React.CSSProperties;

export default function Submitted() {
  const state = (useLocation().state as SubmittedState | null) ?? {};
  const { title, slug, warnings } = state;
  const n = warnings?.length ?? 0;
  // Confetti for a submission that just went through, once: not for a visit
  // to the bare URL, and not for a visitor who asked for reduced motion.
  const fired = useRef(false);
  useEffect(() => {
    if (!slug || fired.current) return;
    fired.current = true;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    confettiBurst();
  }, [slug]);
  return (
    <PageMain detail center className="min-h-[50vh] max-w-[760px] pt-[64px] max-[640px]:pt-[72px]">
      <p className="kicker rise m-0" style={rise(0)}>Thank you</p>
      {/* The board hero's scale: this page is the other end of the same trip. */}
      <h1
        className="rise m-0 mt-3.5 font-inter-tight text-[clamp(36px,9.6vw,80px)] font-bold leading-none tracking-[-.04em]"
        style={rise(1)}
      >
        Congratulations
      </h1>
      {title && (
        <p
          className="rise mx-auto mb-0 mt-7 max-w-[620px] text-balance font-inter-tight text-[clamp(19px,3vw,26px)] font-medium leading-[1.25] tracking-[-.01em] text-white [overflow-wrap:anywhere]"
          style={rise(2)}
        >
          {title}
        </p>
      )}
      <p
        className="rise mx-auto mb-0 mt-3.5 max-w-[560px] text-balance font-inter-tight text-[clamp(15px,2.2vw,17px)] font-light leading-[1.65] text-muted"
        style={rise(3)}
      >
        Your initiative is in the review queue. Once an admin approves it, it will appear on the
        initiatives board and can start collecting pledges and donations.
      </p>

      {n > 0 && (
        <div className="rise mx-auto mt-8 max-w-[560px]" style={rise(4)}>
          <Status kind="wait">
            You submitted past {n} warning{n === 1 ? "" : "s"}. The reviewer sees the same list.
          </Status>
        </div>
      )}

      <p
        className="rise mb-0 mt-8 flex flex-wrap items-center justify-center gap-2.5 max-[640px]:flex-col max-[640px]:items-stretch"
        style={rise(5)}
      >
        {slug && (
          <LinkButton variant="primary" to={`/initiative/${slug}`}>
            See your initiative (pending review)
          </LinkButton>
        )}
        <Link className="btn" to="/mine">All your submissions</Link>
        <Link className="btn" to="/">Back to the board</Link>
      </p>
    </PageMain>
  );
}
