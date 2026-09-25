import { useId } from "react";
import type { Route } from "next";
import { ArrowRight, Megaphone } from "lucide-react";
import { Alert, ButtonLink, StatusPill, type StatusPillTone } from "@/components/ui";
import type { BusinessAnnouncementSummary } from "@/lib/data/admin/businesses";

export interface BusinessAnnouncementsSummaryProps {
  stationName: string;
  isActive: boolean;
  summary: BusinessAnnouncementSummary;
  everyNTracks: number;
  /** 0.10–1.00 */
  volume: number;
  /** /admin/announcements?business=<id> */
  announcementsHref: string;
}

interface Stat {
  key: string;
  label: string;
  value: number;
  tone: StatusPillTone;
  hint: string;
}

/**
 * The Announcements tab: a read-only summary; clips and their settings are managed on screen 07.
 * The counts use the studio's own classification, so both screens show the same numbers.
 */
export function BusinessAnnouncementsSummary({
  stationName,
  isActive,
  summary,
  everyNTracks,
  volume,
  announcementsHref,
}: BusinessAnnouncementsSummaryProps) {
  const headingId = useId();
  const onAir: Stat[] = [
    { key: "welcome", label: "Welcome message", value: summary.onAirWelcome, tone: "success", hint: "Plays once when the radio starts" },
    { key: "station", label: "Station identity", value: summary.onAirRotation, tone: "success", hint: "Plays between songs" },
  ];
  const attention: Stat[] = [
    { key: "review", label: "Need review", value: summary.needsReview, tone: "warning", hint: "Flagged after a branding change" },
    { key: "ready", label: "Ready for review", value: summary.awaitingApproval, tone: "info", hint: "Audio ready, not approved yet" },
    { key: "switched-off", label: "Deactivated", value: summary.switchedOff, tone: "neutral", hint: "Approved, but switched off" },
    { key: "failed", label: "Failed", value: summary.failed, tone: "danger", hint: "Generation failed or stalled" },
    { key: "drafts", label: "Drafts", value: summary.inProgress, tone: "neutral", hint: "No audio yet, or generating" },
  ];

  return (
    <section aria-labelledby={headingId} className="grid gap-5">
      <div className="grid gap-1">
        <h3 id={headingId} className="text-lg font-semibold text-fg">
          Announcements
        </h3>
        <p className="text-sm text-fg-muted">
          Recordings with {stationName}’s name, played between songs. Only approved recordings are ever played.
        </p>
      </div>

      {summary.total === 0 ? (
        <div className="flex items-start gap-3 rounded-control border border-dashed border-border-strong p-4 text-sm text-fg-muted">
          <Megaphone aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p>No announcements yet, so the radio plays music only. Create a welcome message and a station identity.</p>
        </div>
      ) : (
        <>
          <dl className="grid gap-3 @sm:grid-cols-2">
            {onAir.map((stat) => (
              <div key={stat.key} className="grid gap-1 rounded-control border border-border bg-control p-3">
                <dt className="text-sm text-fg-muted">{stat.label}</dt>
                <dd className="flex items-center gap-2">
                  {stat.value > 0 ? (
                    <StatusPill tone="success" label={stat.value === 1 ? "On air" : `${stat.value} on air`} size="sm" />
                  ) : (
                    <StatusPill tone="neutral" label="None on air" size="sm" />
                  )}
                </dd>
                <dd className="text-xs text-fg-subtle">{stat.hint}</dd>
              </div>
            ))}
          </dl>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm @lg:grid-cols-3 @3xl:grid-cols-5">
            {attention.map((stat) => (
              <div key={stat.key} className="grid content-start gap-1">
                <dt className="text-fg-muted">{stat.label}</dt>
                <dd>
                  {stat.value > 0 ? (
                    <StatusPill tone={stat.tone} label={String(stat.value)} size="sm" />
                  ) : (
                    <span className="text-fg-subtle">0</span>
                  )}
                </dd>
                <dd className="text-xs text-fg-subtle">{stat.hint}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {summary.needsReview > 0 && (
        <Alert
          tone="warning"
          title={summary.needsReview === 1 ? "1 announcement needs review" : `${summary.needsReview} announcements need review`}
          description="The branding changed after they were written or approved. Check them on the Announcements page: approved ones stay off air until you listen to them and approve them again."
        />
      )}
      {!isActive && summary.onAir > 0 && (
        <Alert tone="info" description="The venue is inactive, so nothing plays until it is activated again." />
      )}

      <p className="text-sm text-fg-muted">
        {everyNTracks === 1 ? "An announcement after every completed song" : `An announcement after every ${everyNTracks} completed songs`}
        , at {Math.round(volume * 100)}% volume.
      </p>

      <ButtonLink href={announcementsHref as Route} variant="secondary" fullWidth iconRight={<ArrowRight aria-hidden="true" />}>
        Manage announcements
      </ButtonLink>
    </section>
  );
}
