import PageMain from "~/components/layout/PageMain";
import Skeleton from "~/components/ui/Skeleton";

/** The admin dashboard's shape while it loads: title, three status cards, sync bar, two tables. */
export default function DashboardSkeleton() {
  return (
    <PageMain detail aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <div className="mt-4 flex items-center justify-between gap-5">
        <Skeleton className="h-11 w-72" />
        <Skeleton className="h-8 w-48 rounded-full" />
      </div>
      <div className="mt-3.5 grid grid-cols-3 gap-3 max-[860px]:grid-cols-1">
        <Skeleton className="h-[68px] rounded-2xl" />
        <Skeleton className="h-[68px] rounded-2xl" />
        <Skeleton className="h-[68px] rounded-2xl" />
      </div>
      <Skeleton className="mt-3 h-[76px] rounded-2xl" />
      <Skeleton className="mt-[46px] h-3.5 w-52" />
      <Skeleton className="mt-4 h-[140px] rounded-2xl" />
      <Skeleton className="mt-[46px] h-3.5 w-36" />
      <Skeleton className="mt-4 h-[260px] rounded-2xl" />
    </PageMain>
  );
}
