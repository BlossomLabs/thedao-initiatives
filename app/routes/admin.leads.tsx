import { sessionKey, useSession } from "~/context/session";
import { useQuery } from "@tanstack/react-query";
import Skeleton from "~/components/ui/Skeleton";
import { Link } from "react-router";
import PageMain from "~/components/layout/PageMain";
import Crumbs from "~/components/layout/Crumbs";
import { StatusChip, TypeBadge } from "~/components/ui/Badge";
import { Button } from "~/components/ui/Button";
import { api } from "~/lib/api";
import type { FunderLead } from "~/lib/api-types";
import { dt } from "~/lib/format";
import { generateMeta } from "~/utils/meta";
import { leadsCsv } from "~/lib/leads-csv";

export function meta() {
  return generateMeta({ title: "Funder leads", url: "/admin/leads", noIndex: true });
}

// Keep the route export for callers that already consume this helper.
export { leadsCsv } from "~/lib/leads-csv";

/**
 * Private fundraising intelligence from the "Who is likely to fund this?" field.
 * Never linked from a public page.
 */
export default function Leads() {
  const { session } = useSession();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "leads", sessionKey(session)] as const,
    queryFn: ({ signal }) => api<{ rows: FunderLead[] }>("/api/admin/leads", { signal }),
    enabled: Boolean(session?.isAdmin),
  });
  const rows = error ? [] : data?.rows ?? [];
  const download = () => {
    const blob = new Blob([leadsCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "funder-leads.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <PageMain detail>
      <Crumbs items={[{ label: "Initiatives", to: "/" }, { label: "Admin", to: "/admin" }]} />
      <div className="flex items-center justify-between gap-5">
        <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
          Funder leads{" "}
          <span className="align-middle font-inter-tight text-[16px] font-normal text-muted">
            {rows.length}
          </span>
        </h1>
        <Button variant="ghost" onClick={download} disabled={!rows.length}>Download CSV</Button>
      </div>
      <p className="small dim mt-2.5">
        Private fundraising intelligence from the "Who is likely to fund this?" field. Never
        published. The CSV is the interchange for the CRM. Values that could be interpreted as
        formulas start with “Text: ”.
      </p>
      {isLoading && (
        <div aria-busy="true" aria-label="Loading">
          <Skeleton className="mt-4 h-[46px] rounded-t-2xl" />
          <Skeleton className="mt-px h-12" />
          <Skeleton className="mt-px h-12" />
          <Skeleton className="mt-px h-12 rounded-b-2xl" />
        </div>
      )}
      {error && (
        <p className="alert">{error instanceof Error ? error.message : "Could not load leads."}</p>
      )}
      {data && !rows.length && (
        <p className="text-muted">No initiative has named likely funders yet.</p>
      )}
      {rows.length > 0 && (
        <div className="tblbox mt-4">
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Who is likely to fund this</th>
                <th>Contact</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/admin/initiatives/${r.slug}`}>{r.title}</Link>
                  </td>
                  <td>
                    <TypeBadge type={r.type} inline />
                  </td>
                  <td>
                    <StatusChip status={r.status} />
                  </td>
                  <td className="small max-w-[420px] whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {r.funders}
                  </td>
                  <td className="small [overflow-wrap:anywhere]">{r.contact}</td>
                  <td className="small whitespace-nowrap">{dt(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageMain>
  );
}
