import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shown inside the admin shell while an admin page loads (the sidebar and account menu stay
 * usable). The blocks match the shared page geometry: heading + action, then a list card with a
 * filter row and rows, next to an editor panel on wide screens.
 */
export default function AdminLoading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between lg:pb-4">
        <div className="grid gap-3">
          <Skeleton className="h-9 w-56 sm:h-11 sm:w-72" />
          <Skeleton className="h-5 w-64 max-w-full" />
        </div>
        <Skeleton className="h-12 w-44 rounded-control" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-4 rounded-card border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 sm:w-48" />
          </div>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 border-t border-border pt-4">
              <Skeleton className="size-12 shrink-0 rounded-control" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-28 max-w-full" />
              </div>
              <Skeleton className="hidden h-7 w-20 rounded-full sm:block" />
              <Skeleton className="h-7 w-20 rounded-full" />
            </div>
          ))}
        </div>
        <div className="hidden content-start gap-4 rounded-card border border-border bg-surface p-5 xl:grid">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="aspect-[3/2] w-full rounded-card" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </div>
  );
}
