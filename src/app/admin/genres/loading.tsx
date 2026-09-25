import { Skeleton } from "@/components/ui/Skeleton";

/**
 * /admin/genres while it loads (the admin shell stays usable): heading + Add genre, search, the
 * two-column card grid and the "Edit genre" panel from 1024px, matching the final geometry.
 */
export default function AdminGenresLoading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <p role="status" className="sr-only">
        Loading genres…
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:pb-2">
        <div className="grid gap-3">
          <Skeleton className="h-9 w-40 sm:h-11 sm:w-48" />
          <Skeleton className="h-5 w-64 max-w-full" />
        </div>
        <Skeleton className="h-11 w-36" />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-4">
          <Skeleton className="h-11 w-full" />
          <div className="grid grid-cols-2 gap-3 xl:gap-4">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-card border border-border bg-surface">
                <Skeleton className="aspect-[16/10] w-full rounded-none xl:aspect-[5/2]" />
                <div className="flex items-center gap-3 p-3 xl:px-4 xl:py-3.5">
                  <Skeleton className="hidden h-11 w-8 xl:block" />
                  <div className="grid flex-1 gap-2">
                    <Skeleton className="h-5 w-24 max-w-full" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <Skeleton className="hidden size-11 xl:block" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden content-start gap-4 rounded-card border border-border bg-surface p-5 lg:grid">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="aspect-[16/9] w-full rounded-card" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </div>
  );
}
