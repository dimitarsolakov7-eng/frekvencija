import { Skeleton } from "@/components/ui/Skeleton";

/**
 * /admin/music while it loads (the admin shell stays usable): heading + Upload button, the tab strip,
 * the filter row, table rows shaped like the real ones, the "Selected track" panel from 1024px and
 * the upload queue panel, so nothing jumps when the data arrives.
 */
export default function AdminMusicLoading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <p role="status" className="sr-only">
        Loading the music library…
      </p>
      <div className="flex flex-col gap-4 pb-0 sm:flex-row sm:items-end sm:justify-between lg:pb-2">
        <div className="grid gap-3">
          <Skeleton className="h-9 w-64 sm:h-11 sm:w-80" />
          <Skeleton className="h-5 w-56 max-w-full" />
        </div>
        <Skeleton className="h-11 w-44" />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-5">
          <div className="flex gap-6 border-b border-border pb-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem_11rem]">
            <Skeleton className="h-11 w-full" />
            <div className="grid grid-cols-2 gap-3 md:contents">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <div className="flex h-12 items-center gap-4 border-b border-border px-4">
              <Skeleton className="size-5 rounded" />
              <Skeleton className="h-4 w-16" />
            </div>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
                <Skeleton className="size-5 shrink-0 rounded" />
                <Skeleton className="size-12 shrink-0 rounded-control md:size-14" />
                <div className="grid min-w-0 flex-1 gap-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3.5 w-32 max-w-full" />
                </div>
                <Skeleton className="hidden h-6 w-20 rounded-lg xl:block" />
                <Skeleton className="hidden h-4 w-10 2xl:block" />
                <Skeleton className="hidden h-8 w-24 rounded-full md:block" />
                <Skeleton className="size-9 shrink-0" />
              </div>
            ))}
          </div>
          <Skeleton className="h-4 w-20" />
        </div>

        <div className="hidden content-start gap-4 rounded-card border border-border bg-surface p-5 lg:mt-16 lg:grid">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="aspect-[4/3] w-full rounded-card" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-4 w-16" />
          <div className="grid gap-2 xl:grid-cols-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="h-11 w-full" />
        </div>
      </div>

      <div className="grid gap-4 rounded-card border border-border bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline gap-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex items-center gap-4 rounded-card border border-border bg-control p-4">
          <Skeleton className="size-11 shrink-0" />
          <div className="grid gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="hidden h-1.5 flex-1 rounded-full md:block" />
          <Skeleton className="ml-auto h-9 w-20 md:ml-0" />
        </div>
      </div>
    </div>
  );
}
