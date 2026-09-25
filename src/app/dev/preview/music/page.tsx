import type { Metadata, Route } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/shell";
import { parseTrackListQuery } from "@/components/admin/catalog/track-query";
import { cn } from "@/lib/utils/cn";
import { buildMusicFixture } from "./fixtures";
import { MusicPreview } from "./MusicPreview";

export const metadata: Metadata = { title: "Music library preview" };

// Reads the filters and the variant from the query string on every request.
export const dynamic = "force-dynamic";

type Scenario = "default" | "empty";

const SCENARIOS: readonly { value: Scenario; label: string }[] = [
  { value: "default", label: "Example tracks" },
  { value: "empty", label: "Empty catalogue" },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Development-only preview of screen 05 (/dev/preview/music): the real MusicLibrary inside the admin
 * shell with the design's example tracks (Afterglow, Slow Motion, …). Search, genre, status, sort and
 * paging work against the fixtures; actions are no-ops, uploads are simulated (a file name containing
 * "broken" fails validation) and previews play the synthetic demo audio. `?scenario=empty` shows the
 * empty catalogue. The /dev layout returns 404 in production.
 */
export default async function MusicPreviewPage({ searchParams }: PageProps<"/dev/preview/music">) {
  const params = await searchParams;
  const scenario: Scenario = first(params.scenario) === "empty" ? "empty" : "default";
  const fixture = buildMusicFixture(parseTrackListQuery(params), { empty: scenario === "empty" });

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
              href={(item.value === "default" ? "/dev/preview/music" : `/dev/preview/music?scenario=${item.value}`) as Route}
              aria-current={item.value === scenario ? "page" : undefined}
              className={cn(
                "rounded-full border px-2.5 py-1 transition-colors",
                item.value === scenario ? "border-accent/50 bg-accent/15 text-fg" : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {item.label}
            </Link>
          ))}
          <Link href={"/dev/preview/genres" as Route} className="text-accent-text underline-offset-4 hover:underline">
            Genres preview
          </Link>
        </div>
      </nav>
      <MusicPreview key={scenario} query={fixture.query} genres={fixture.genres} page={fixture.page} unknownGenre={fixture.unknownGenre} />
    </AdminShell>
  );
}
