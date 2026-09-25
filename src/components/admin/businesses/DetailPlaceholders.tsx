import type { Route } from "next";
import { Building2, SearchX } from "lucide-react";
import { ButtonLink, Card, Skeleton } from "@/components/ui";

/** The detail column before a venue is chosen (desktop only; phones show the list instead). */
export function BusinessDetailPlaceholder({ basePath }: { basePath: string }) {
  return (
    <Card className="grid justify-items-center gap-3 px-6 py-14 text-center">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
        <Building2 className="size-6" />
      </span>
      <h2 className="text-lg font-semibold text-fg">Select a business</h2>
      <p className="max-w-xs text-sm text-fg-muted text-pretty">
        Choose a venue from the list to edit its profile, manage who can sign in, and see its announcements.
      </p>
      <ButtonLink href={`${basePath}/new` as Route} variant="secondary" className="mt-2">
        Add business
      </ButtonLink>
    </Card>
  );
}

/** notFound() inside the directory: the venue was deleted or the link is wrong. */
export function BusinessNotFound({ basePath }: { basePath: string }) {
  return (
    <Card className="grid justify-items-center gap-3 px-6 py-14 text-center">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
        <SearchX className="size-6" />
      </span>
      <h2 tabIndex={-1} data-detail-heading="*" className="text-lg font-semibold text-fg focus:outline-none">
        This business doesn’t exist
      </h2>
      <p className="max-w-xs text-sm text-fg-muted text-pretty">
        It may have been deleted, or the link is mistyped. Choose a venue from the list instead.
      </p>
      <ButtonLink href={basePath as Route} variant="secondary" className="mt-2">
        All businesses
      </ButtonLink>
    </Card>
  );
}

/** Loading skeleton of the detail panel (tabs, identity block, fields, genre tiles, actions). */
export function BusinessDetailSkeleton() {
  return (
    <div aria-busy="true" className="rounded-card border border-border bg-surface p-5 shadow-card sm:p-6">
      <p role="status" className="sr-only">
        Loading the business…
      </p>
      <div className="flex gap-6 border-b border-border pb-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="mt-6 flex items-start gap-4">
        <Skeleton className="size-20 shrink-0 rounded-card sm:size-28" />
        <div className="grid flex-1 gap-2 pt-1">
          <Skeleton className="h-7 w-40 max-w-full" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>
      <div className="mt-6 grid gap-4">
        <Skeleton className="h-5 w-36" />
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
        <Skeleton className="mt-2 h-5 w-28" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
        <Skeleton className="h-11 w-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </div>
  );
}
