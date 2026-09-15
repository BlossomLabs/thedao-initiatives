import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import PageMain from "~/components/layout/PageMain";
import { TypeBadge } from "~/components/ui/Badge";
import ConnectInline from "~/components/wallet/ConnectInline";
import { useSession } from "~/context/session";
import { api, errorMessage } from "~/lib/api";
import type { InitiativeStatus, MineItem } from "~/lib/api-types";
import { dt, usd } from "~/lib/format";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "My initiatives", url: "/mine", noIndex: true });
}

const STATUS: Record<InitiativeStatus, string> = {
  pending: "pending review",
  approved: "on the board",
  rejected: "not accepted",
  archived: "archived",
};

/** Everything the signed-in wallet proposed, so a pending one is never lost. */
export default function Mine() {
  const { session } = useSession();
  const { data, isLoading, error } = useQuery({
    queryKey: ["mine", session?.address],
    queryFn: () => api<{ initiatives: MineItem[] }>("/api/initiatives/mine"),
    enabled: Boolean(session),
  });
  const rows = data?.initiatives ?? [];
  return (
    <PageMain narrow detail className="min-h-[50vh]">
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        My initiatives
      </h1>
      <p className="mt-3.5 font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        Everything proposed from your wallet, including what is still waiting for review.
      </p>
      {!session && (
        <p className="flex flex-wrap items-center gap-3">
          <span className="small dim">Sign in with the wallet you submitted from.</span>
          <ConnectInline />
        </p>
      )}
      {session && isLoading && <p className="small dim">Loading…</p>}
      {session && error && <p className="alert">{errorMessage(error)}</p>}
      {session && data && rows.length === 0 && (
        <p className="small dim">
          Nothing proposed from this wallet yet. <Link to="/submit">Submit an initiative</Link>.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="m-0 mt-6 list-none p-0">
          {rows.map((r) => (
            <li
              key={r.slug}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-0 border-t border-solid border-white/10 py-3.5"
            >
              <Link
                to={`/initiative/${r.slug}`}
                className="font-inter-tight text-[16px] text-white"
              >
                {r.title}
              </Link>
              <span className="flex flex-wrap items-center gap-2.5 small dim">
                <TypeBadge type={r.type} inline />
                <span className={`chip chip-badge st-${r.status}`}>{STATUS[r.status]}</span>
                {r.goalUsd > 0 && <span>{usd(r.goalUsd)}</span>}
                <span>{dt(r.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </PageMain>
  );
}
