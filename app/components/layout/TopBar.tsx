import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Menu, X } from "lucide-react";
import { cn } from "~/lib/utils";
import Pop from "~/components/ui/Pop";
import WatchlistOfferSlot from "~/components/wallet/WatchlistOfferSlot";
import { useSession } from "~/context/session";
import { useBallotNews, useMyBadges } from "~/hooks/use-vote";
import NewCount from "~/components/vote/NewCount";
import { useRound, useRoundLoaded, useVoteBase } from "~/lib/vote-round";
import { roundDeployed } from "../../../shared/vote/manifest";

const ConnectButton = lazy(() => import("~/components/wallet/ConnectButton"));

// Figma: 12px 32px bar, Inter Tight 14px links 22px apart, active link green with a 2px underline.
const link = ({ isActive }: { isActive: boolean }) =>
  cn(
    "relative font-inter-tight text-[14px] no-underline hover:no-underline hover:text-dao-green",
    isActive
      ? "text-dao-green after:absolute after:left-0 after:right-0 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-dao-green"
      : "text-white/65",
  );

// The same links as menu rows on phones (the wallet menu's row style).
const menuLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center rounded-[9px] px-3 py-2.5 font-inter-tight text-[14px] no-underline hover:no-underline hover:bg-[rgba(92,183,90,.08)] hover:text-dao-green",
    isActive ? "text-dao-green" : "text-soft",
  );

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  active?: (path: string) => boolean;
  /** My ballot: how many initiatives are new since the ballot was last sent. */
  fresh?: number;
};

const LINKS: NavItem[] = [
  { to: "/", label: "Initiatives", end: true },
  { to: "/submit", label: "Suggest an initiative" },
];

/** The vote's own links (#124), for the vote the page is on (the vote, or the test vote on
 * /vote-test): Vote, to the results, and for a badge holder My ballot, to the ballot that
 * counts (which moves on to the editor while there is none). None while that vote has no
 * round deployed. */
function useVoteLinks(): NavItem[] {
  const base = useVoteBase();
  useRoundLoaded();
  const round = useRound();
  const deployed = roundDeployed(round);
  const { session } = useSession();
  const badges = useMyBadges(session?.address ?? null, deployed);
  // In the same request as the badges (/api/vote/mine): the most any badge has to catch up on.
  const fresh = useBallotNews(session?.address ?? null, deployed).data ?? 0;
  if (!deployed) return [];
  const ballot = `${base}/ballot`;
  return [
    { to: base, label: "Vote", end: true },
    ...(badges.data?.length
      ? [{
        to: ballot,
        label: "My ballot",
        fresh,
        active: (path: string) => path === ballot || path.startsWith(`${ballot}/`),
      }]
      : []),
  ];
}

/** The site's links, then the vote's (in the full app; the static shell has no vote). */
function NavLinks({ render }: { render: (l: NavItem) => React.ReactNode }) {
  const vote = useVoteLinks();
  return <>{[...LINKS, ...vote].map(render)}</>;
}

const Fallback = () => (
  <button type="button" className="btn btn-wallet" disabled>
    Connect wallet
  </button>
);

export default function TopBar({ staticShell }: { staticShell?: boolean }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const menuRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close on navigation, on Escape, and on a tap anywhere else.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || toggleRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The static shell is prerendered once (at "/") and served for every URL
  // without a page of its own, so it marks no link as current: plain links,
  // which also keeps its HTML identical to what the client hydrates there.
  const text = (l: NavItem) => (
    <>
      {l.label}
      {l.fresh ? <NewCount n={l.fresh} className="ml-1.5 align-[1px]" /> : null}
    </>
  );
  const item = (l: NavItem, style: typeof link) =>
    staticShell
      ? <Link key={l.to} to={l.to} className={style({ isActive: false })}>{text(l)}</Link>
      : l.active
      ? (
        <Link
          key={l.to}
          to={l.to}
          aria-current={l.active(pathname) ? "page" : undefined}
          className={style({ isActive: l.active(pathname) })}
        >
          {text(l)}
        </Link>
      )
      : <NavLink key={l.to} to={l.to} end={l.end} className={style}>{text(l)}</NavLink>;
  const links = (style: typeof link) =>
    staticShell ? LINKS.map((l) => item(l, style)) : <NavLinks render={(l) => item(l, style)} />;

  return (
    <header className="sticky top-0 z-50 border-b border-white/[.07] bg-[rgba(44,94,134,.5)] px-8 py-3 backdrop-blur-[20px] max-[760px]:px-3.5 max-[760px]:py-2.5">
      <div className="flex items-center justify-between gap-4 max-[760px]:gap-2.5">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 font-inter-tight text-[17px] font-light text-white no-underline hover:no-underline"
        >
          <img
            src="/dao-logo.svg"
            alt="Đ"
            width={22}
            height={22}
            className="size-[22px] flex-none"
          />
          <span className="whitespace-nowrap">
            <b className="font-bold">TheDAO</b>{" "}
            <span className="max-[640px]:hidden">Security Fund</span>
          </span>
        </Link>
        <div className="flex items-center gap-[22px] max-[760px]:gap-2.5">
          <nav className="flex items-center gap-[22px] max-[760px]:hidden" aria-label="Site">
            {links(link)}
          </nav>
          {staticShell ? <Fallback /> : (
            <div className="relative">
              <Suspense fallback={<Fallback />}>
                <ConnectButton />
              </Suspense>
              <WatchlistOfferSlot />
            </div>
          )}
          <button
            ref={toggleRef}
            type="button"
            className="btn btn-wallet hidden w-[38px] px-0 max-[760px]:inline-flex"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
          </button>
        </div>
      </div>
      <Pop
        show={open}
        as="nav"
        ref={menuRef}
        id="site-menu"
        aria-label="Site"
        className="absolute inset-x-3.5 top-full mt-2 hidden flex-col rounded-[14px] border border-edge2 bg-panel p-1.5 shadow-menu max-[760px]:flex"
      >
        {links(menuLink)}
      </Pop>
    </header>
  );
}
