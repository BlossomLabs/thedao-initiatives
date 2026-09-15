import DashboardSkeleton from "~/components/layout/DashboardSkeleton";
import PageSkeleton from "~/components/layout/PageSkeleton";

/**
 * Inline head script (root.tsx) that picks the shell's skeleton before the
 * first paint: marks the admin dashboard URL (/admin) so app.css shows that shape.
 */
export const SHELL_SCRIPT =
  "if(/^\\/admin\\/?$/.test(location.pathname))document.documentElement.dataset.shell='dashboard'";

/**
 * The prerendered SPA shell's placeholder. One static HTML file serves every
 * non-prerendered URL, so it carries both page shapes and a head script in
 * root.tsx picks one before the first paint from the pathname
 * (`html[data-shell="dashboard"]` for the admin dashboard at /admin, the detail layout
 * otherwise; see app.css). The route then renders the same skeleton until its
 * data lands, so a direct hit shows one stable shape until the content.
 */
export default function ShellSkeleton() {
  return (
    <>
      <div className="shell-detail">
        <PageSkeleton />
      </div>
      <div className="shell-dashboard">
        <DashboardSkeleton />
      </div>
    </>
  );
}
