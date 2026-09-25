import { Skeleton } from "@/components/ui/Skeleton";

function CardSkeleton({ fields, tall = false }: { fields: number; tall?: boolean }) {
  return (
    <div className="grid gap-5 rounded-card border border-border bg-surface p-5 sm:p-6">
      <div className="grid gap-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="grid gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className={tall ? "h-48 w-full" : "h-11 w-full"} />
        </div>
      ))}
    </div>
  );
}

/** Skeleton of /admin/settings: three form cards and the integration status column. */
export default function SettingsLoading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <p role="status" className="sr-only">
        Loading the settings…
      </p>
      <div className="grid gap-3 pb-2 lg:pb-4">
        <Skeleton className="h-9 w-40 sm:h-11 sm:w-52" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="grid gap-6">
          <CardSkeleton fields={2} />
          <CardSkeleton fields={1} />
          <CardSkeleton fields={2} tall />
        </div>
        <div className="grid gap-4 rounded-card border border-border bg-surface p-5 sm:p-6">
          <Skeleton className="h-6 w-44" />
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-start gap-3">
              <Skeleton className="size-5 shrink-0 rounded-full" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
