import type { Metadata, Route } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/shell";
import { cn } from "@/lib/utils/cn";
import { PREVIEW_BUSINESSES, PREVIEW_GENRES } from "./fixtures";
import { GenresPreview } from "./GenresPreview";

export const metadata: Metadata = { title: "Genres preview" };

// Reads the variant from the query string on every request.
export const dynamic = "force-dynamic";

type Scenario = "default" | "empty";

const SCENARIOS: readonly { value: Scenario; label: string }[] = [
  { value: "default", label: "Six genres" },
  { value: "empty", label: "No genres yet" },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Development-only preview of screen 08 (/dev/preview/genres): the real GenreManager inside the admin
 * shell with the design's example genres and venues, no-op Server Actions (reordering, saving and
 * cover changes are shown but not stored) and simulated cover uploads, so it can be reviewed at
 * 1440/768/390 px without Supabase. `?scenario=empty` shows the empty state. The /dev layout returns
 * 404 in production.
 */
export default async function GenresPreviewPage({ searchParams }: PageProps<"/dev/preview/genres">) {
  const params = await searchParams;
  const scenario: Scenario = first(params.scenario) === "empty" ? "empty" : "default";
  const genres = scenario === "empty" ? [] : PREVIEW_GENRES.map((genre) => ({ ...genre, accessBusinessIds: [...genre.accessBusinessIds] }));

  return (
    <AdminShell email="admin@frekvencija.online">
      <nav
        aria-label="Preview variants"
        className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-dashed border-border-strong px-4 py-3 text-xs"
      >
        <span className="font-semibold text-fg">Dev preview · fixtures only</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-fg-subtle">Catalogue:</span>
          {SCENARIOS.map((item) => (
            <Link
              key={item.value}
              href={`/dev/preview/genres?scenario=${item.value}` as Route}
              aria-current={item.value === scenario ? "page" : undefined}
              className={cn(
                "rounded-full border px-2.5 py-1 transition-colors",
                item.value === scenario ? "border-accent/50 bg-accent/15 text-fg" : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {item.label}
            </Link>
          ))}
          <Link href={"/dev/preview/music" as Route} className="text-accent-text underline-offset-4 hover:underline">
            Music library preview
          </Link>
        </div>
      </nav>
      <GenresPreview key={scenario} genres={genres} businesses={[...PREVIEW_BUSINESSES]} />
    </AdminShell>
  );
}
