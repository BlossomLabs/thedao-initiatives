import { Link } from "react-router";
import { MessageSquare } from "lucide-react";
import type { CommunityEntry } from "~/lib/api-types";
import { RoleTags } from "~/components/ui/Badge";
import Identity from "~/components/wallet/Identity";
import { truncate } from "~/lib/format";

export default function CommunityStrip({ entries }: { entries: CommunityEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="mx-auto max-w-[1080px] px-[22px]">
      <h2 className="mb-2.5 mt-[18px] font-inter-tight text-[19px] font-semibold">
        From the community
      </h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {entries.map((c) => (
          <Link
            key={c.id}
            to={`/initiative/${c.initiative.slug}#qa`}
            className="flex flex-col gap-1.5 rounded-[10px] border border-white/[.12] bg-white/[.02] px-3.5 py-3 text-inherit no-underline hover:border-[rgba(92,183,90,.5)] hover:no-underline"
          >
            <span className="inline-flex items-center text-muted">
              <MessageSquare className="size-[15px]" />
            </span>
            <span className="flex flex-wrap items-center gap-1.5 font-inter-tight text-[13.5px] font-semibold">
              {c.address
                ? (
                  <Identity
                    address={c.address}
                    size={18}
                    linked={false}
                    nameClassName="text-[13.5px] font-semibold"
                  />
                )
                : c.displayName}
              <RoleTags roles={c.roles} />
            </span>
            <span className="text-[13.5px] leading-[1.45] text-white/80 [overflow-wrap:anywhere]">
              {truncate(c.body, 120)}
            </span>
            <span className="text-[12px] text-muted">on {c.initiative.title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
