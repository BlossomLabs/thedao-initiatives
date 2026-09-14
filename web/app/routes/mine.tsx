import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import PageMain from "~/components/layout/PageMain";
import ConnectInline from "~/components/wallet/ConnectInline";
import { useSession } from "~/context/session";
import { api } from "~/lib/api";
import type { InitiativeStatus, MineItem } from "~/lib/api-types";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "My initiatives", url: "/mine", noIndex: true });
}

const STATUS: Record<InitiativeStatus, string> = {
  pending: "Pending review",
  approved: "On the board",
  rejected: "Not accepted",
  archived: "Archived",
};

const when = (ts: number) =>
  new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

/**
 * Everything the signed-in wallet submitted, with its status. A pending
 * initiative is only reachable by URL otherwise (Griff, RFPs group 2026-09-14).
 */
export default function Mine() {
  const { session } = useSession();
  const token = session?.token ?? null;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["mine", token],
    queryFn: () => api<{ initiatives: MineItem[] }>("/api/initiatives/mine"),
    enabled: Boolean(token),
  });
  const rows = data?.initiatives ?? [];
  return (
    <PageMain narrow detail className="min-h-[50vh]">
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        My initiatives
      </h1>
      <p className="mt-3.5 font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        Everything submitted from your wallet, including initiatives still waiting for review.
      </p>
      {!session && (
        <p className="flex items-center gap-3">
          <span className="small dim">Sign in with the wallet you submitted from.</span>
          <ConnectInline />
        </p>
      )}
      {session && isLoading && <p className="small dim">Loading…</p>}
      {session && isError && (
        <p className="alert">Your initiatives could not be loaded. Please try again in a moment.</p>
      )}
      {session && data && rows.length === 0 && (
        <p className="small dim">
          Nothing submitted from this wallet yet. <Link to="/submit">Submit an initiative</Link>.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="m-0 mt-6 list-none p-0">
          {rows.map((r) => (
            <li
              key={r.slug}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-0 border-t border-solid border-white/10 py-3.5"
            >
              <Link
                to={`/initiative/${r.slug}`}
                className="font-inter-tight text-[16px] text-white"
              >
                {r.title}
              </Link>
              <span className="small dim">
                {STATUS[r.status] ?? r.status} · {r.type === "grant" ? "Grant" : "RFP"} ·{" "}
                {when(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PageMain>
  );
}
