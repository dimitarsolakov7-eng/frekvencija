import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

function CardSkeleton({ fields, columns = 2 }: { fields: number; columns?: 1 | 2 }) {
  return (
    <div className="grid gap-5 rounded-card border border-border bg-surface p-5 sm:p-6">
      <div className="grid gap-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className={cn("grid gap-4", columns === 2 && "sm:grid-cols-2")}>
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="grid gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-11" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton with the geometry of the account page (heading, details + settings, password + sign out). */
export default function AccountLoading() {
  return (
    <div role="status" aria-busy="true" className="grid gap-6">
      <span className="sr-only">Loading your account…</span>
      <div className="grid gap-2.5 lg:pb-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-48 sm:h-10 lg:h-12" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          <CardSkeleton fields={5} />
          <CardSkeleton fields={2} columns={1} />
        </div>
        <div className="grid gap-6">
          <CardSkeleton fields={2} columns={1} />
          <Skeleton className="h-36 rounded-card!" />
        </div>
      </div>
    </div>
  );
}
