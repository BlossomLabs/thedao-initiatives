import Skeleton from "~/components/ui/Skeleton";

/**
 * Placeholders for /vote/:code while the code is checked, each in the shape
 * of the page that follows: the welcome (claim) page, or the ballot.
 */

/** The welcome page: the headline, three cards and the claim button. */
export function IntroSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col items-center pt-4">
        <Skeleton className="h-3 w-56" />
        <Skeleton className="mt-4 h-[clamp(36px,9vw,56px)] w-[min(60%,280px)]" />
        <Skeleton className="mt-4 h-6 w-[min(85%,420px)]" />
      </div>
      <div className="!my-6 h-px bg-white/10" />
      <div className="card space-y-3">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-4/5" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3 pt-1">
            <Skeleton className="size-6 flex-none rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <div className="card space-y-3">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <div className="card space-y-3">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
      </div>
      <Skeleton className="h-12 rounded-full" />
    </div>
  );
}

const TIERS = [0, 1, 2];

/** The ballot: the header, the tier list (a strip on a phone) and the list of cards. */
export function BallotSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col items-center pt-4">
        <Skeleton className="h-3 w-64" />
        <Skeleton className="mt-4 h-[clamp(28px,5vw,40px)] w-48" />
        <Skeleton className="mt-4 h-4 w-[min(92%,600px)]" />
        <Skeleton className="mt-2 h-4 w-[min(70%,440px)]" />
      </div>
      <div className="grid grid-cols-1 items-start gap-0 sm:grid-cols-2 sm:gap-6">
        <div>
          {/* The ballot box: the ring round the avatar, the ask and the share, the menu. */}
          <div className="relative mb-4 flex items-center gap-4 rounded-xl border border-vote/30 bg-vote/[.06] p-4 sm:mb-3">
            <Skeleton className="size-16 flex-none rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
            <Skeleton className="absolute right-3 top-3 h-2 w-5 rounded-full" />
          </div>
          <div className="-mx-6 mb-4 space-y-1 border-b border-white/10 bg-panel/95 px-4 py-2 sm:mx-0 sm:mb-0 sm:space-y-2 sm:rounded-2xl sm:border sm:bg-white/[.03] sm:p-3">
            {TIERS.map((t) => (
              <div
                key={t}
                className="flex h-9 items-center gap-2 rounded-lg bg-white/[.03] pl-1.5 sm:h-[76px] sm:items-stretch sm:rounded-xl sm:border sm:border-white/10 sm:p-1.5"
              >
                <Skeleton className="size-7 flex-none rounded-md sm:h-auto sm:w-[76px] sm:rounded-lg" />
                <Skeleton className="h-3 w-40 sm:hidden" />
              </div>
            ))}
          </div>
          {/* The send bar sits under the tiers on wider screens. */}
          <div className="mt-3 hidden space-y-3 rounded-2xl border border-white/10 bg-white/[.03] p-4 sm:block">
            <Skeleton className="h-11 rounded-full" />
            <Skeleton className="mx-auto h-3 w-56" />
          </div>
        </div>
        <div>
          {/* The round box: the stepper, the current step, the badge's line. */}
          <div className="mb-4 space-y-4 rounded-xl border border-white/15 bg-white/[.04] p-4">
            <div className="grid grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <Skeleton className="size-[22px] rounded-full" />
                  <Skeleton className="h-3 w-12 max-sm:hidden" />
                </div>
              ))}
            </div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-[min(90%,420px)]" />
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
            <div className="mb-1 flex h-7 items-center gap-2 px-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="ml-auto h-7 w-28 rounded-full sm:h-8" />
            </div>
            <Skeleton className="mx-1 mb-3 mt-2 h-3 w-64" />
            <Skeleton className="mb-3 h-11 rounded-xl" />
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
