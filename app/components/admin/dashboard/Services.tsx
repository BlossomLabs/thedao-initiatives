import { When } from "~/components/vote/When";
import { errorMessage } from "~/lib/api";
import type { AdminStatus } from "~/lib/api-types";
import { cn } from "~/lib/utils";
import { DetailSkeleton } from "./TodoSection";

/** Green when every service the admin depends on answers; amber or red names the one that does not. */
export const servicesOk = (s: AdminStatus) => s.safeApi.configured && s.signers.ok;

function Item(
  { ok, title, children }: { ok: boolean; title: string; children: React.ReactNode },
) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-edge p-3.5">
      <span className="flex items-center gap-2 font-inter-tight text-[14px] font-semibold">
        <span
          aria-hidden="true"
          className={cn(
            "size-[9px] flex-none rounded-full",
            ok ? "bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]" : "bg-dao-amber",
          )}
        />
        {title}
      </span>
      <span className="small dim">{children}</span>
    </div>
  );
}

/** The Safe API, the chain check and the Safe deploy signers, from saved snapshots. */
export default function Services(
  { data, isLoading, error }: { data?: AdminStatus; isLoading: boolean; error: unknown },
) {
  if (isLoading) return <DetailSkeleton />;
  if (error || !data) {
    return (
      <p className="alert" role="alert">
        The status could not be loaded. {errorMessage(error, "")}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      <Item
        ok={data.safeApi.configured}
        title={`Safe API ${data.safeApi.configured ? "authenticated" : "NOT configured"}`}
      >
        Refreshes when viewed after {data.safeApi.refreshMinutes} minutes
        {data.safeApi.quota ? ` · ${data.safeApi.quota.remaining} requests left` : ""}
      </Item>
      <Item ok={data.chain.checkedAt > 0} title="Chain">
        {data.chain.detail}
        {data.chain.checkedAt > 0 && (
          <>
            {" · checked "}
            <When at={data.chain.checkedAt} />
          </>
        )}
      </Item>
      <Item ok={data.signers.ok} title={`Safe deploys ${data.signers.ok ? "enabled" : "disabled"}`}>
        {data.signers.detail} · threshold {data.signers.threshold}
      </Item>
    </div>
  );
}
