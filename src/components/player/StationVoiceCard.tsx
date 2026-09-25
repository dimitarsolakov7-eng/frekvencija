import { Play, RotateCcw, Square, X } from "lucide-react";
import { Button, Card, IconButton, Spinner, Waveform } from "@/components/ui";
import type { AnnouncementSummary } from "@/lib/api/contracts";
import { cn } from "@/lib/utils/cn";
import { NO_VOICE_CLIP_COPY, everyNSongsLabel } from "./player-view";
import type { VoicePreviewView } from "./voice-preview";

export interface StationVoiceCardProps {
  /** The venue's clip shown and previewed (see pickVoiceClip), or null when none is approved. */
  clip: AnnouncementSummary | null;
  /** Whether the venue has a clip that plays between songs (the interval badge only makes sense then). */
  hasRotation: boolean;
  everyNTracks: number;
  preview: VoicePreviewView;
  onPreview(): void;
  onStop(): void;
  onResumeRadio(): void;
  onDismiss(): void;
  className?: string;
}

function intervalBadge(clip: AnnouncementSummary | null, hasRotation: boolean, everyNTracks: number): string | null {
  if (!clip) return null;
  if (hasRotation) return everyNSongsLabel(everyNTracks);
  return "When the radio starts";
}

/**
 * "Your station voice" (screens 03/04): the venue's own approved clip with its wording, how often it
 * plays, and a Preview that pauses the radio, plays the clip on its own and then offers an explicit
 * "Resume radio". The preview never goes through the engine, so it never counts as a song.
 */
export function StationVoiceCard({
  clip,
  hasRotation,
  everyNTracks,
  preview,
  onPreview,
  onStop,
  onResumeRadio,
  onDismiss,
  className,
}: StationVoiceCardProps) {
  const badge = intervalBadge(clip, hasRotation, everyNTracks);
  const busy = preview.mode === "loading" || preview.mode === "playing";

  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <section aria-labelledby="station-voice-title" className="flex items-start gap-4">
        <Waveform bars={7} seed={clip?.id ?? "station-voice"} tone={clip ? "accent" : "muted"} className="mt-1 h-10 w-11 shrink-0 md:hidden" />
        <div className="grid min-w-0 flex-1 gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="station-voice-title" className="text-lg font-bold tracking-tight text-fg sm:text-xl">
              Your station voice
            </h2>
            {badge && (
              <span className="inline-flex h-8 items-center rounded-control border border-border-strong px-3 text-sm text-fg-muted">
                {badge}
              </span>
            )}
          </div>

          <Waveform
            bars={40}
            seed={clip?.id ?? "station-voice"}
            tone={clip ? "accent" : "muted"}
            className="hidden h-8 w-full max-w-72 md:flex"
          />

          {clip ? (
            <blockquote className="text-base text-fg-muted italic text-pretty sm:text-lg">
              <p>“{clip.text}”</p>
            </blockquote>
          ) : (
            <p className="text-sm text-fg-muted text-pretty">{NO_VOICE_CLIP_COPY}</p>
          )}

          {clip && (
            <div className="flex flex-wrap items-center gap-2">
              {busy ? (
                <Button variant="secondary" size="sm" icon={<Square aria-hidden="true" fill="currentColor" />} onClick={onStop}>
                  Stop preview
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={
                    preview.mode === "failed" ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" fill="currentColor" />
                  }
                  onClick={onPreview}
                >
                  {preview.mode === "failed" ? "Try again" : preview.mode === "done" ? "Preview again" : "Preview"}
                </Button>
              )}
              {preview.offerResume && (
                <Button size="sm" icon={<Play aria-hidden="true" fill="currentColor" />} onClick={onResumeRadio}>
                  Resume radio
                </Button>
              )}
              {(preview.mode === "done" || preview.mode === "failed") && (
                <IconButton aria-label="Close preview" size="sm" icon={<X />} onClick={onDismiss} />
              )}
              {/* Always rendered (empty while idle) so the first status change is announced. */}
              <p
                role="status"
                className={cn("flex min-w-0 items-center gap-2 text-sm", preview.mode === "failed" ? "text-warning" : "text-fg-muted")}
              >
                {preview.mode === "loading" && <Spinner size="sm" decorative />}
                {preview.status}
              </p>
            </div>
          )}
        </div>
      </section>
    </Card>
  );
}
