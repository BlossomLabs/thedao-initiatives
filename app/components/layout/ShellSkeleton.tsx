import DashboardSkeleton from "~/components/layout/DashboardSkeleton";
import PageSkeleton from "~/components/layout/PageSkeleton";

/**
 * Inline head script (root.tsx) that picks the shell's skeleton before the
 * first paint: marks the admin dashboard URL (/admin) so app.css shows that shape,
 * and the vote's pages (/vote…), which show none: their own skeleton follows at once,
 * and two shapes in a row read as a flicker.
 */
export const SHELL_SCRIPT = "var p=location.pathname,d=document.documentElement.dataset;" +
  "if(/^\\/admin\\/?$/.test(p))d.shell='dashboard';" +
  "else if(/^\\/vote(\\/|$)/.test(p))d.shell='vote'";

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
