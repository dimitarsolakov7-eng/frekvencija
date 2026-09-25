import type { Metadata, Route } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/shell";
import { cn } from "@/lib/utils/cn";
import { AnnouncementsPreview } from "./AnnouncementsPreview";
import type { PreviewScenario, PreviewTts } from "./fixtures";

export const metadata: Metadata = { title: "Announcements preview" };

// Reads the variant from the query string on every request.
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTts(value: string | undefined): PreviewTts {
  return value === "off" || value === "rejected" ? value : "on";
}

function parseScenario(value: string | undefined): PreviewScenario {
  return value === "review" || value === "empty" ? value : "default";
}

const TTS_VARIANTS: readonly { value: PreviewTts; label: string }[] = [
  { value: "on", label: "Voice configured" },
  { value: "off", label: "Voice not configured" },
  { value: "rejected", label: "Key rejected" },
];

const SCENARIOS: readonly { value: PreviewScenario; label: string }[] = [
  { value: "default", label: "Ready for review" },
  { value: "review", label: "Needs review + failed" },
  { value: "empty", label: "No recordings" },
];

function VariantLinks<T extends string>({
  label,
  items,
  current,
  href,
}: {
  label: string;
  items: readonly { value: T; label: string }[];
  current: T;
  href: (value: T) => Route;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-fg-subtle">{label}:</span>
      {items.map((item) => (
        <Link
          key={item.value}
          href={href(item.value)}
          aria-current={item.value === current ? "page" : undefined}
          className={cn(
            "rounded-full border px-2.5 py-1 transition-colors",
            item.value === current ? "border-accent/50 bg-accent/15 text-fg" : "border-border text-fg-muted hover:text-fg",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Development-only preview of screen 07 (/dev/preview/announcements): the real announcements studio
 * inside the admin shell, with EmeraldBar fixtures, no-op Server Actions and a fake browser API, so
 * it can be reviewed at 1440/768/390 px without Supabase or ElevenLabs. `?tts=on|off|rejected` and
 * `?scenario=default|review|empty` pick the variant. The /dev layout returns 404 in production.
 */
export default async function AnnouncementsPreviewPage({ searchParams }: PageProps<"/dev/preview/announcements">) {
  const params = await searchParams;
  const tts = parseTts(first(params.tts));
  const scenario = parseScenario(first(params.scenario));
  const href = (next: { tts?: PreviewTts; scenario?: PreviewScenario }) =>
    `/dev/preview/announcements?tts=${next.tts ?? tts}&scenario=${next.scenario ?? scenario}` as Route;

  return (
    <AdminShell email="admin@frekvencija.online">
      <nav
        aria-label="Preview variants"
        className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-dashed border-border-strong px-4 py-3 text-xs"
      >
        <span className="font-semibold text-fg">Dev preview · fixtures only</span>
        <VariantLinks label="Voice" items={TTS_VARIANTS} current={tts} href={(value) => href({ tts: value })} />
        <VariantLinks label="Recordings" items={SCENARIOS} current={scenario} href={(value) => href({ scenario: value })} />
      </nav>
      <AnnouncementsPreview key={`${tts}:${scenario}`} tts={tts} scenario={scenario} />
    </AdminShell>
  );
}
