import { Skeleton } from "@/components/ui";

/** Skeleton with the geometry of the help page (heading, guide + troubleshooting, tips + contact). */
export default function HelpLoading() {
  return (
    <div role="status" aria-busy="true" className="grid gap-6">
      <span className="sr-only">Loading help…</span>
      <div className="grid gap-2.5 lg:pb-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9 w-72 max-w-full sm:h-10 lg:h-12 lg:w-96" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          <Skeleton className="h-80 rounded-card!" />
          <Skeleton className="h-96 rounded-card!" />
        </div>
        <div className="grid gap-6">
          <Skeleton className="h-44 rounded-card!" />
          <Skeleton className="h-96 rounded-card!" />
          <Skeleton className="h-36 rounded-card!" />
        </div>
      </div>
    </div>
  );
}
