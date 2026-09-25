import { Skeleton } from "@/components/ui/Skeleton";

/** Skeleton of the access-request list: heading, status filter pills and request cards. */
export default function AccessRequestsLoading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <p role="status" className="sr-only">
        Loading the access requests…
      </p>
      <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between lg:pb-4">
        <div className="grid gap-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-9 w-64 sm:h-11 sm:w-80" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
        <Skeleton className="h-11 w-40 rounded-control" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-24 rounded-full" />
        ))}
      </div>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="grid gap-4 rounded-card border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-16 w-full" />
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
