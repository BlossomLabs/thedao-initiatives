import PageMain from "~/components/layout/PageMain";
import Skeleton from "~/components/ui/Skeleton";

/** The admin dashboard's shape while it loads: title, the counts line, the to-do cards beside the side column. */
export default function DashboardSkeleton() {
  return (
    <PageMain detail aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <div className="mt-4 flex items-center justify-between gap-5">
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-9 w-24 rounded-[14px]" />
      </div>
      <Skeleton className="mt-3 h-3.5 w-80 max-w-full" />
      <div className="mt-5 flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-4">
          <Skeleton className="h-[200px] rounded-2xl" />
          <Skeleton className="h-[120px] rounded-2xl" />
          <Skeleton className="h-[160px] rounded-2xl" />
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <Skeleton className="h-[150px] rounded-2xl" />
          <Skeleton className="h-[130px] rounded-2xl" />
        </div>
      </div>
      <Skeleton className="mt-5 h-[320px] rounded-2xl" />
    </PageMain>
  );
}
