import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Skeleton of the announcements studio (screen 07) with the final geometry: breadcrumb, station
 * title and venue selector; the editor (segmented tabs + "Create an announcement") on the left; the
 * settings and recordings cards on the right (stacked below the editor under 1280px).
 */
export default function AnnouncementsLoading() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading announcements…
      </p>
      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between lg:pb-8">
        <div className="grid gap-2.5">
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-9 w-72 max-w-full sm:h-11 sm:w-96" />
          <Skeleton className="h-5 w-48" />
        </div>
        <Skeleton className="h-11 w-full sm:w-64" />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(21rem,1fr)]">
        <div className="grid gap-4 rounded-card sm:border sm:border-border sm:bg-surface/40 sm:p-3">
          <Skeleton className="h-12 w-full sm:w-80" />
          <div className="grid gap-5 rounded-card border border-border bg-surface p-5 sm:p-6">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <div className="flex flex-wrap gap-2">
              {[24, 40, 36, 44, 36].map((width, index) => (
                <Skeleton key={index} className="h-9 rounded-full" style={{ width: `${width * 4}px` }} />
              ))}
            </div>
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-24 w-full" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-11 w-full" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
            <Skeleton className="h-12 w-full" />
          </div>
        </div>

        <div className="grid gap-6">
          <div className="grid gap-5 rounded-card border border-border bg-surface p-5 sm:p-6">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-52" />
              <Skeleton className="h-4 w-full max-w-72" />
            </div>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="grid gap-4 rounded-card border border-border bg-surface p-5 sm:p-6">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-4 w-full max-w-80" />
            </div>
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-3 rounded-card border border-border p-3">
                <Skeleton className="size-14 shrink-0" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="size-11 rounded-full" />
                <Skeleton className="size-11 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
