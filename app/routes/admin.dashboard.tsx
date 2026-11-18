import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ChevronDown, X } from "lucide-react";
import PageMain from "~/components/layout/PageMain";
import DashboardSkeleton from "~/components/layout/DashboardSkeleton";
import Crumbs from "~/components/layout/Crumbs";
import Pop from "~/components/ui/Pop";
import { Button } from "~/components/ui/Button";
import Admins from "~/components/admin/Admins";
import Submissions from "~/components/admin/dashboard/Submissions";
import Edits from "~/components/admin/dashboard/Edits";
import Comments from "~/components/admin/dashboard/Comments";
import QuickPledge from "~/components/admin/dashboard/QuickPledge";
import AllInitiatives from "~/components/admin/dashboard/AllInitiatives";
import Services, { servicesOk } from "~/components/admin/dashboard/Services";
import { useAdminStatus, useAdminTodo } from "~/components/admin/dashboard/queries";
import { useSession } from "~/context/session";
import { useSiteSettings } from "~/hooks/use-site-settings";
import { errorMessage } from "~/lib/api";
import { plural } from "~/lib/format";
import { roundAdminTodoLine } from "~/lib/admin-rows";
import { roundLoader, useRound } from "~/lib/vote-round";
import { roundDeployed } from "../../shared/vote/manifest";
import RoundAdminQueue from "~/components/admin/vote/RoundAdminQueue";
import { useRoundAdminQueue } from "~/components/admin/vote/round-admin-actions";
import { cn } from "~/lib/utils";

/** The round the site runs now, so the round admin card shows only when one is deployed. */
export const clientLoader = roundLoader;

/** The tools an admin uses now and then, shown on this page when picked from More. */
const PANELS = { services: "Services" } as const;
type Panel = keyof typeof PANELS;

function Dot({ on, color }: { on: boolean; color: "green" | "red" | "gold" | "amber" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-[8px] flex-none rounded-full",
        !on && "bg-white/30",
        on && color === "green" && "bg-dao-green shadow-[0_0_10px_rgba(92,183,90,.6)]",
        on && color === "red" && "bg-dao-red shadow-[0_0_10px_rgba(255,59,56,.6)]",
        on && color === "gold" && "bg-vote",
        on && color === "amber" && "bg-dao-amber",
      )}
    />
  );
}

/**
 * The admin dashboard (#89): what is waiting for an admin first, in the order
 * admins do it (approve submissions, accept edits, moderate), beside the admin
 * list (always in view, for security) and the pledge shortcut, with every
 * initiative in the table below. The first paint is one KV-only request; the
 * table and the services follow with their own requests, a skeleton holding
 * the table's place.
 */
export default function Dashboard() {
  const { signOut } = useSession();
  const site = useSiteSettings().data;
  const todo = useAdminTodo();
  const [params, setParams] = useSearchParams();
  const panel = (params.get("panel") ?? "") as Panel | "";
  const status = useAdminStatus(true);
  const deployed = roundDeployed(useRound());
  // The card's own query (same key): the line always matches the card, and shows once it loads.
  const queue = useRoundAdminQueue("production", deployed);
  const [menu, setMenu] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      // The wrapper holds the button and the menu: a tap anywhere else closes it.
      if (!buttonRef.current?.contains(t)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const openPanel = (next: Panel | "") => {
    setMenu(false);
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (next) out.set("panel", next);
      else out.delete("panel");
      return out;
    }, { replace: true, preventScrollReset: true });
  };

  if (todo.isLoading) return <DashboardSkeleton />;
  const data = todo.data;
  if (todo.error || !data) {
    return (
      <PageMain detail>
        <p className="alert" role="alert">
          The dashboard could not be loaded. {errorMessage(todo.error, "")}
        </p>
      </PageMain>
    );
  }
  const maintenance = site?.maintenance;
  const vote = site?.vote;
  const roundTodo = deployed && queue.data
    ? roundAdminTodoLine(queue.data.ready.length, queue.data.toSign.length)
    : null;
  const ok = status.data ? servicesOk(status.data) : null;
  const menuItem =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3.5 py-2.5 text-left font-inter-tight text-[14px] text-white no-underline hover:bg-white/[.08]";

  return (
    <PageMain detail>
      <Crumbs items={[{ label: "Initiatives", to: "/" }]} />
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
          <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
            Admin
          </h1>
          <p className="m-0 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-white/80">
            <span>{plural(data.counts.total, "initiative")}</span>
            <span>{data.counts.approved} approved</span>
            <span>This week: {data.counts.approvedThisWeek} approved</span>
            {roundTodo && (
              <a href="#round-admin" className="text-inherit hover:text-white">{roundTodo}</a>
            )}
            {ok !== null && (
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-inherit hover:text-white"
                onClick={() => openPanel("services")}
              >
                <Dot on color={ok ? "green" : "amber"} />
                {ok ? "Services up" : "A service needs a look"}
              </button>
            )}
          </p>
        </div>
        <div className="relative ml-auto" ref={buttonRef}>
          <Button
            variant="ghost"
            sm
            aria-expanded={menu}
            aria-controls="admin-more"
            onClick={() => setMenu(!menu)}
          >
            More <ChevronDown className="size-3.5" aria-hidden="true" />
          </Button>
          <Pop
            show={menu}
            as="nav"
            id="admin-more"
            aria-label="More admin tools"
            className="absolute right-0 top-full z-20 mt-2 flex w-[260px] flex-col rounded-[14px] border border-edge2 bg-panel p-1.5 shadow-menu"
          >
            <Link className={menuItem} to="/admin/leads" onClick={() => setMenu(false)}>
              Funder leads <span className="small dim ml-auto">private</span>
            </Link>
            <Link className={menuItem} to="/admin/vote" onClick={() => setMenu(false)}>
              {vote && <Dot on={vote.show} color="gold" />}
              Vote{vote ? (vote.show ? ", on the site" : ", hidden") : ""}
            </Link>
            <Link className={menuItem} to="/admin/maintenance" onClick={() => setMenu(false)}>
              {maintenance && <Dot on color={maintenance.on ? "red" : "green"} />}
              Maintenance mode{maintenance ? (maintenance.on ? " on" : " off") : ""}
            </Link>
            {(Object.keys(PANELS) as Panel[]).map((k) => (
              <button
                key={k}
                type="button"
                className={menuItem}
                onClick={() => openPanel(k)}
              >
                {PANELS[k]}
              </button>
            ))}
            <span className="mx-2 my-1 h-px bg-white/10" aria-hidden="true" />
            <button type="button" className={menuItem} onClick={() => void signOut()}>
              Log out
            </button>
          </Pop>
        </div>
      </header>

      {panel && panel in PANELS && (
        <section
          aria-labelledby="admin-panel-h"
          className="mt-5 rounded-[18px] border border-edge2 bg-[rgba(10,30,50,.28)] p-5"
        >
          <div className="mb-3.5 flex items-center gap-3">
            <h2 id="admin-panel-h" className="m-0 font-inter-tight text-[20px] font-semibold">
              {PANELS[panel]}
            </h2>
            <Button
              variant="ghost"
              sm
              className="ml-auto"
              aria-label={`Close ${PANELS[panel]}`}
              onClick={() => openPanel("")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          {panel === "services" && <Services {...status} />}
        </section>
      )}

      <div className="mt-5 flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-4">
          <Submissions rows={data.submissions} />
          <Edits rows={data.edits} />
          <Comments data={data} />
        </div>
        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          {/* Always in view, first: who can sign in here is a security fact, checked at a glance. */}
          <Admins />
          <QuickPledge index={data.index} />
          {deployed && (
            <div id="round-admin" className="scroll-mt-20">
              <RoundAdminQueue env="production" title="Waiting for a round admin" />
            </div>
          )}
        </aside>
      </div>

      <div className="mt-5">
        <AllInitiatives total={data.counts.total} />
      </div>
    </PageMain>
  );
}
