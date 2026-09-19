import PageMain from "~/components/layout/PageMain";
import Crumbs from "~/components/layout/Crumbs";
import Maintenance from "~/components/admin/Maintenance";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({
    title: "Maintenance and backups",
    url: "/admin/maintenance",
    noIndex: true,
  });
}

/** Rarely used and sharp, so it lives off the dashboard, one click away. */
export default function MaintenancePage() {
  return (
    <PageMain detail className="max-w-[860px]">
      <Crumbs items={[{ label: "Initiatives", to: "/" }, { label: "Admin", to: "/admin" }]} />
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        Maintenance and backups
      </h1>
      <p className="small dim mt-2.5">
        Pause every write on the site, take the database home as one file, and put a file back.
      </p>
      <Maintenance />
    </PageMain>
  );
}
