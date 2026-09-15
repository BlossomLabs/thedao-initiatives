import PageMain from "~/components/layout/PageMain";
import Skeleton from "~/components/ui/Skeleton";

/**
 * Placeholder for the detail layout. Used both by the prerendered SPA shell
 * (before the route module and data exist) and by the initiative route while
 * it loads, so a direct hit shows one stable skeleton until the content lands.
 */
export default function PageSkeleton() {
  return (
    <PageMain detail aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-4 h-11 w-3/4 max-w-[720px]" />
      <Skeleton className="mt-3.5 h-6 w-16 rounded-full" />
      <div className="mt-4 grid grid-cols-[1fr_340px] items-start gap-9 max-[960px]:grid-cols-1">
        <div className="min-w-0">
          <Skeleton className="h-[122px] rounded-[18px]" />
          <Skeleton className="mt-[46px] h-3.5 w-24" />
          <Skeleton className="mt-4 h-4" />
          <Skeleton className="mt-2.5 h-4 w-11/12" />
          <Skeleton className="mt-2.5 h-4 w-4/5" />
          <Skeleton className="mt-[46px] h-3.5 w-44" />
          <Skeleton className="mt-4 h-4" />
          <Skeleton className="mt-2.5 h-4 w-10/12" />
          <Skeleton className="mt-2.5 h-4 w-11/12" />
          <Skeleton className="mt-2.5 h-4 w-3/5" />
        </div>
        <div className="flex flex-col gap-3.5 max-[960px]:hidden">
          <Skeleton className="h-[200px] rounded-[18px]" />
          <Skeleton className="h-[120px] rounded-[18px]" />
          <Skeleton className="h-[160px] rounded-[18px]" />
        </div>
      </div>
    </PageMain>
  );
}
