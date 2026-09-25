"use client";

import type { Ref } from "react";
import {
  CircleCheck,
  CircleOff,
  Copy,
  Pencil,
  Power,
  RotateCcw,
  SquarePen,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, CoverImage, DropdownMenu, renderIcon, Spinner, type DropdownMenuItem } from "@/components/ui";
import { recordingLabel } from "@/lib/announcements/labels";
import { cn } from "@/lib/utils/cn";
import { ClipPlayButton, type AudioClip } from "./AnnouncementAudio";
import type { AnnouncementBusiness, AnnouncementItem } from "./rules";
import {
  RECORDING_ACTION_LABELS,
  RECORDING_STATE_PILLS,
  recordingArtwork,
  recordingDetail,
  recordingMenuActions,
  recordingPrimaryAction,
  recordingState,
  splitRecordings,
  type RecordingActionKey,
  type RecordingTone,
} from "./studio-model";

export interface RecordingsPanelProps {
  business: AnnouncementBusiness;
  items: readonly AnnouncementItem[];
  now: number;
  /** Recording currently open in the editor (marked "In editor"). */
  editingId: string | null;
  /** `${id}:${action}` running right now, if any. */
  pendingKey: string | null;
  onAction: (item: AnnouncementItem, action: RecordingActionKey) => void;
  clipFor: (item: AnnouncementItem) => AudioClip;
  /** Focus target after a row disappears (e.g. deleted). */
  headingRef?: Ref<HTMLHeadingElement>;
}

const ACTION_ICONS: Readonly<Record<RecordingActionKey, LucideIcon>> = {
  approve: CircleCheck,
  reapprove: CircleCheck,
  activate: Power,
  deactivate: CircleOff,
  editWording: Pencil,
  continue: SquarePen,
  duplicate: Copy,
  retry: RotateCcw,
  markFailed: TriangleAlert,
  delete: Trash2,
};

const TONE_CLASSES: Readonly<Record<RecordingTone, { text: string; dot: string }>> = {
  success: { text: "text-accent-text", dot: "bg-accent" },
  warning: { text: "text-warning", dot: "bg-warning" },
  danger: { text: "text-danger", dot: "bg-danger" },
  info: { text: "text-info", dot: "bg-info" },
  neutral: { text: "text-fg-muted", dot: "bg-fg-muted" },
};

function shortText(text: string, max = 80): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/** "Station identity “You’re listening to EmeraldBar Radio.”" — tells same-placement rows apart. */
export function recordingAccessibleName(item: AnnouncementItem): string {
  return `${recordingLabel(item.placement)} “${shortText(item.text)}”`;
}

function RecordingRow({
  item,
  business,
  now,
  editing,
  pendingKey,
  onAction,
  clip,
}: {
  item: AnnouncementItem;
  business: AnnouncementBusiness;
  now: number;
  editing: boolean;
  pendingKey: string | null;
  onAction: RecordingsPanelProps["onAction"];
  clip: AudioClip;
}) {
  const state = recordingState(item, business, now);
  const pill = RECORDING_STATE_PILLS[state];
  const tone = TONE_CLASSES[pill.tone];
  const primary = recordingPrimaryAction(item, business, now);
  const menu = recordingMenuActions(item, business, now);
  const detail = recordingDetail(item, business, now);
  const name = recordingAccessibleName(item);
  const pendingAction = pendingKey?.startsWith(`${item.id}:`) ? pendingKey.slice(item.id.length + 1) : null;
  const anyPending = pendingKey !== null;
  // The recording open in the editor is approved or retried from the audio preview instead.
  const showPrimary = primary !== null && !editing;

  const menuItems: DropdownMenuItem[] = menu.flatMap((key): DropdownMenuItem[] => {
    const entry: DropdownMenuItem = {
      key,
      label: RECORDING_ACTION_LABELS[key],
      icon: ACTION_ICONS[key],
      tone: key === "delete" ? "danger" : "default",
      onSelect: () => onAction(item, key),
    };
    return key === "delete" && menu.length > 1 ? [{ type: "separator", key: "separator" }, entry] : [entry];
  });

  return (
    <li
      aria-busy={state === "generating" || undefined}
      className={cn("grid grid-cols-1 gap-3 rounded-card border bg-control p-3", editing ? "border-accent/50" : "border-border")}
    >
      <div className="flex items-center gap-3">
        <CoverImage fallbackSrc={recordingArtwork(item.placement)} sizes="56px" className="size-14 shrink-0 rounded-control" />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-semibold text-fg">{recordingLabel(item.placement)}</span>
            {editing && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-medium text-fg">In editor</span>
            )}
          </p>
          <p className={cn("flex items-center gap-1.5 text-sm font-medium", tone.text)}>
            {state === "generating" ? (
              <Spinner size="sm" decorative />
            ) : (
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
            )}
            {pill.label}
          </p>
        </div>
        {item.hasAudio && <ClipPlayButton clip={clip} label={name} />}
        {menuItems.length > 0 && (
          <DropdownMenu label={`Actions for ${name}`} items={menuItems} triggerVariant="outline" disabled={anyPending} triggerClassName="rounded-full" />
        )}
      </div>
      <p className="truncate text-sm text-fg-muted" title={item.text}>
        “{item.text}”
      </p>
      {detail && <p className="text-sm text-fg-muted text-pretty">{detail}</p>}
      {showPrimary && primary && (
        <div>
          <Button
            size="sm"
            variant={primary === "approve" || primary === "reapprove" || primary === "activate" ? "primary" : "secondary"}
            icon={renderIcon(ACTION_ICONS[primary])}
            loading={pendingAction === primary}
            disabled={anyPending && pendingAction !== primary}
            onClick={() => onAction(item, primary)}
            aria-label={`${RECORDING_ACTION_LABELS[primary]}: ${name}`}
          >
            {RECORDING_ACTION_LABELS[primary]}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Right column of screen 07: "Active recordings" (what the venue plays) and, below them, the other
 * recordings (needs review, failed, generating, awaiting approval, drafts, switched off), each with
 * play (one preview at a time) and the actions its state allows.
 */
export function RecordingsPanel({ business, items, now, editingId, pendingKey, onAction, clipFor, headingRef }: RecordingsPanelProps) {
  const { onAir, other } = splitRecordings(items, business, now);
  return (
    <Card className="grid grid-cols-1 gap-5 p-5 sm:p-6">
      <div className="grid gap-1">
        <h2 ref={headingRef} tabIndex={-1} className="section-title font-bold text-fg outline-none">
          Active recordings
        </h2>
        <p className="text-sm text-fg-muted">
          {business.isActive
            ? "These recordings are approved and currently used on this station."
            : "These recordings are approved. They play once the venue is activated."}
        </p>
      </div>

      {onAir.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-4 py-5 text-sm text-fg-muted text-pretty">
          Nothing is on air yet, so the station plays music only. Create a recording, listen to it and approve it to put it on air.
        </p>
      ) : (
        <ul className="grid gap-3" aria-label="Active recordings">
          {onAir.map((item) => (
            <RecordingRow
              key={item.id}
              item={item}
              business={business}
              now={now}
              editing={item.id === editingId}
              pendingKey={pendingKey}
              onAction={onAction}
              clip={clipFor(item)}
            />
          ))}
        </ul>
      )}

      {other.length > 0 && (
        <section aria-labelledby="other-recordings-heading" className="grid gap-3 border-t border-border pt-5">
          <div className="grid gap-1">
            <h3 id="other-recordings-heading" className="text-base font-semibold text-fg">
              Other recordings <span className="font-normal text-fg-muted">({other.length})</span>
            </h3>
            <p className="text-sm text-fg-muted">Not on air: awaiting approval, needing review, failed, drafts and switched-off recordings.</p>
          </div>
          <ul className="grid gap-3" aria-label="Other recordings">
            {other.map((item) => (
              <RecordingRow
                key={item.id}
                item={item}
                business={business}
                now={now}
                editing={item.id === editingId}
                pendingKey={pendingKey}
                onAction={onAction}
                clip={clipFor(item)}
              />
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}
