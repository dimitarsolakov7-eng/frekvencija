"use client";

import { CircleCheck, RotateCcw, RefreshCw } from "lucide-react";
import { Alert, Button, Card, Spinner, StatusPill, Waveform } from "@/components/ui";
import { isGenerationInProgress } from "@/lib/announcements/state";
import { formatBytes } from "@/lib/utils/format";
import { ClipPlayer, type AudioClip } from "./AnnouncementAudio";
import { modelLabel, type AnnouncementBusiness, type AnnouncementItem } from "./rules";
import { RECORDING_ACTION_LABELS, RECORDING_STATE_PILLS, recordingPrimaryAction, recordingState } from "./studio-model";

/** What the editor is doing with the generation right now (client side). */
export type GenerationPhase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "generating" }
  | { kind: "reused" }
  | { kind: "error"; message: string };

export interface AudioPreviewCardProps {
  /** The recording the editor works on (null while nothing has been saved yet). */
  item: AnnouncementItem | null;
  business: AnnouncementBusiness;
  now: number;
  phase: GenerationPhase;
  /** "generate" offers Regenerate; "upload" does not. */
  mode: "generate" | "upload";
  clip: AudioClip | null;
  /** Approve & activate / Re-approve / Activate is running. */
  approving: boolean;
  onApprove: () => void;
  /** Regenerate is possible right now (options loaded, not busy). */
  canRegenerate: boolean;
  onRegenerate: () => void;
  onRetry: () => void;
  /** Another action (upload, save) is running. */
  busy: boolean;
}

function sourceSummary(item: AnnouncementItem): string {
  if (item.source === "upload") {
    return ["Uploaded MP3", item.audioSizeBytes !== null ? formatBytes(item.audioSizeBytes) : null].filter(Boolean).join(" · ");
  }
  return ["AI voice", item.voiceName ?? item.voiceId, modelLabel(item.modelId)].filter(Boolean).join(" · ");
}

/** Whether the card has anything to show for this state. */
export function hasAudioPreview(item: AnnouncementItem | null, phase: GenerationPhase, now: number): boolean {
  if (phase.kind !== "idle") return true;
  if (!item) return false;
  return item.hasAudio || item.status === "failed" || isGenerationInProgress(item, now) || item.status === "generating";
}

/**
 * "Audio preview" (screen 07): the generated or uploaded clip with a real player, its measured
 * duration and status ("Ready for review"), then the explicit Approve & activate and Regenerate.
 */
export function AudioPreviewCard({
  item,
  business,
  now,
  phase,
  mode,
  clip,
  approving,
  onApprove,
  canRegenerate,
  onRegenerate,
  onRetry,
  busy,
}: AudioPreviewCardProps) {
  const serverGenerating = item !== null && isGenerationInProgress(item, now);
  const generating = phase.kind === "saving" || phase.kind === "generating" || serverGenerating;
  const state = item ? recordingState(item, business, now) : null;
  const pill = generating ? RECORDING_STATE_PILLS.generating : state ? RECORDING_STATE_PILLS[state] : null;
  const primary = item ? recordingPrimaryAction(item, business, now) : null;
  const approveAction = primary === "approve" || primary === "reapprove" || primary === "activate" ? primary : null;
  const failedWithoutAudio = item !== null && !item.hasAudio && item.status === "failed";
  const title = mode === "upload" && item?.source !== "tts" ? "Listen to your recording before activating it." : "Listen to the generated announcement before activating it.";

  return (
    <Card className="grid grid-cols-1 gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid gap-1">
          <h3 className="section-title font-bold text-fg">
            Audio preview
          </h3>
          <p className="text-sm text-fg-muted">{title}</p>
        </div>
        {pill && <StatusPill tone={pill.tone} label={pill.label} size="sm" />}
      </div>

      {generating ? (
        <div role="status" className="grid grid-cols-1 gap-3 rounded-card border border-border bg-control p-4">
          <div className="flex items-center gap-3 text-sm text-fg">
            <Spinner size="sm" decorative className="text-accent-text" />
            <span>
              {phase.kind === "saving"
                ? "Saving the wording…"
                : serverGenerating && phase.kind !== "generating"
                  ? "The audio is being generated. This page updates automatically when it is ready."
                  : "Generating the audio… This usually takes 5–20 seconds."}
            </span>
          </div>
          <Waveform bars={56} seed={item?.id ?? "generating"} tone="muted" progress={0} className="h-10 w-full min-w-0 overflow-hidden" />
        </div>
      ) : (
        <>
          {phase.kind === "error" && (
            <Alert
              tone="danger"
              title="The audio was not generated"
              description={`${phase.message}${item?.hasAudio ? " The previous audio was kept." : ""}`}
              action={
                <Button variant="secondary" size="sm" icon={<RotateCcw aria-hidden="true" />} onClick={onRetry} disabled={busy}>
                  Retry
                </Button>
              }
            />
          )}
          {phase.kind !== "error" && failedWithoutAudio && item && (
            <Alert
              tone="danger"
              role="status"
              title="Generating the audio failed"
              description={item.lastError ?? "Try again, or upload a recording instead."}
              action={
                <Button variant="secondary" size="sm" icon={<RotateCcw aria-hidden="true" />} onClick={onRetry} disabled={busy}>
                  Retry
                </Button>
              }
            />
          )}
          {phase.kind === "reused" && (
            <Alert
              tone="info"
              description="Nothing changed since this audio was generated, so it was kept and no credits were used. Use Regenerate for a new take."
            />
          )}
          {item?.hasAudio && clip && (
            <div className="grid grid-cols-1 gap-2">
              <ClipPlayer clip={clip} label="the audio preview" durationSeconds={item.audioDurationSeconds} seed={item.id} />
              <p className="text-sm text-fg-muted">{sourceSummary(item)}</p>
              {item.lastError && phase.kind !== "error" && item.status !== "failed" && (
                <p className="text-sm text-fg-muted text-pretty">
                  <span className="font-medium text-warning">The last attempt failed:</span> {item.lastError} The audio above was kept.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {item?.hasAudio && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            icon={<CircleCheck aria-hidden="true" />}
            onClick={onApprove}
            loading={approving}
            loadingText="Approving…"
            disabled={generating || busy || approveAction === null}
            fullWidth
          >
            {approveAction ? RECORDING_ACTION_LABELS[approveAction] : "Approve & activate"}
          </Button>
          {mode === "generate" && item.source === "tts" && (
            <Button
              variant="outline"
              icon={<RefreshCw aria-hidden="true" />}
              onClick={onRegenerate}
              disabled={generating || busy || !canRegenerate}
              fullWidth
            >
              Regenerate
            </Button>
          )}
        </div>
      )}
      {item?.hasAudio && approveAction === null && !generating && state === "on-air" && (
        <p className="text-sm text-fg-muted">This recording is on air.</p>
      )}
    </Card>
  );
}
