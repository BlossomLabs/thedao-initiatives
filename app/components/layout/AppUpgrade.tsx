import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { RefreshCw } from "lucide-react";
import {
  markClean,
  subscribeUpgrade,
  upgradeNow,
  upgradeOffered,
  watchForUpgrade,
} from "~/lib/app-upgrade";

/** Moves a tab left open across a deploy onto the new build (lib/app-upgrade.ts).
 * A page change is the one moment a reload is always free: the new page loads
 * its data either way, and the old page's form is already gone. Otherwise the
 * page reloads only while nobody is looking at it; in front of a visitor this
 * notice stays up until they refresh, which is theirs to time. */
export default function AppUpgrade() {
  const { pathname } = useLocation();
  const shown = useRef(pathname);
  const offered = useSyncExternalStore(subscribeUpgrade, upgradeOffered, () => false);
  useEffect(() => watchForUpgrade(), []);
  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    markClean();
    upgradeNow();
  }, [pathname]);
  if (!offered) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-[300] flex max-w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-[18px] border border-edge2 bg-panel-modal px-4 py-3 text-[13.5px] shadow-modal animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <RefreshCw className="mt-[3px] size-4 flex-none text-dao-green" aria-hidden="true" />
      <span>
        <b className="font-semibold">A new version of this site is available.</b>{" "}
        Refresh the page to get it.
      </span>
    </div>
  );
}
