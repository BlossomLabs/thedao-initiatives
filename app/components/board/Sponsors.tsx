import { useState } from "react";
import { Link } from "react-router";
import SectionHeading from "~/components/layout/SectionHeading";
import BackerLogo from "~/components/ui/BackerLogo";
import type { Sponsor } from "~/lib/api-types";
import { usd } from "~/lib/format";

/** "Top sponsors of security for Ethereum": the five biggest pledgers across the board.
 * One initiative is a link; more than one shows the biggest and a "+N more" toggle. */
export default function Sponsors({ sponsors }: { sponsors?: Sponsor[] }) {
  if (!sponsors?.length) return null;
  return (
    <section className="mx-auto mb-[46px] max-w-[1100px] px-6" aria-labelledby="sponsors">
      <SectionHeading id="sponsors" className="max-[640px]:text-center">
        Top sponsors of security for Ethereum
      </SectionHeading>
      <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-white/[.09] bg-white/5 font-inter-tight">
        <thead className="max-[640px]:hidden">
          <tr className="text-left text-[11px] uppercase tracking-[.08em] text-muted">
            <th className="w-[84px] py-3 pl-5 pr-3 font-medium">
              <span className="sr-only">Logo</span>
            </th>
            <th className="px-3 py-3 font-medium">Sponsor</th>
            <th className="px-3 py-3 text-right font-medium">Pledged</th>
            <th className="px-5 py-3 font-medium">Initiatives</th>
          </tr>
        </thead>
        <tbody>
          {sponsors.map((s, i) => <Row key={s.company} s={s} rank={i + 1} />)}
        </tbody>
      </table>
    </section>
  );
}

function Row({ s, rank }: { s: Sponsor; rank: number }) {
  const [open, setOpen] = useState(false);
  const [first, ...rest] = s.initiatives;
  const shown = open ? s.initiatives : [first];
  return (
    <tr className="align-top max-[640px]:grid max-[640px]:grid-cols-[auto_1fr_auto] max-[640px]:gap-x-3 max-[640px]:px-4 max-[640px]:py-3.5 [&:not(:first-child)]:border-t [&>td]:border-t [&>td]:border-white/[.07] max-[640px]:[&>td]:border-0 max-[640px]:[&:not(:first-child)]:border-white/[.07]">
      <td className="w-[84px] py-3.5 pl-5 pr-3 max-[640px]:row-span-2 max-[640px]:w-auto max-[640px]:p-0">
        <BackerLogo logoUrl={s.logoUrl} company={s.company} url={s.url} className="min-w-10" />
      </td>
      <td className="px-3 py-3.5 max-[640px]:p-0 max-[640px]:self-center">
        <span className="mono mr-2 text-[12px] text-muted">{rank}</span>
        <b className="text-[15px] font-semibold">
          {s.url ? <a href={s.url} target="_blank" rel="noopener">{s.company}</a> : s.company}
        </b>
      </td>
      <td className="mono px-3 py-3.5 text-right text-[15px] text-dao-green max-[640px]:p-0 max-[640px]:self-center">
        {usd(s.totalUsd)}
      </td>
      <td className="px-5 py-3.5 text-[14px] max-[640px]:col-span-2 max-[640px]:col-start-2 max-[640px]:p-0 max-[640px]:pt-1">
        <ul className="m-0 list-none space-y-1 p-0">
          {shown.map((x) => (
            <li key={x.slug}>
              <Link to={`/initiative/${x.slug}`} className="text-white/85 hover:text-white">
                {x.title}
              </Link>
              {s.initiatives.length > 1 && (
                <span className="mono ml-2 text-[12px] text-muted">{usd(x.amountUsd)}</span>
              )}
            </li>
          ))}
        </ul>
        {rest.length > 0 && (
          <button
            type="button"
            className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[13px] text-dao-green hover:underline"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Show less" : `+${rest.length} more`}
          </button>
        )}
      </td>
    </tr>
  );
}
