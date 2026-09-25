import { Skeleton } from "@/components/ui";

/** Skeleton with the geometry of the radio screen (heading, hero + side cards, genre grid). */
export default function RadioLoading() {
  return (
    <div role="status" aria-busy="true" className="grid gap-6 lg:gap-8">
      <span className="sr-only">Loading your radio…</span>
      <div className="grid gap-2.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-72 max-w-full sm:h-10 lg:h-12 lg:w-96" />
        <Skeleton className="h-5 w-64 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(19rem,1fr)] lg:gap-6">
        <Skeleton className="min-h-72 rounded-card! sm:min-h-80 lg:min-h-92" />
        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <Skeleton className="h-40 rounded-card! sm:h-44" />
          <Skeleton className="h-16 rounded-card! md:h-44" />
        </div>
      </div>
      <div className="grid gap-4">
        <Skeleton className="h-7 w-56" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="overflow-hidden rounded-card border border-border bg-surface">
              <Skeleton className="aspect-[5/2] rounded-none! sm:aspect-[3/1] lg:aspect-[4/1]" />
              <div className="grid gap-2 p-3 sm:p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
