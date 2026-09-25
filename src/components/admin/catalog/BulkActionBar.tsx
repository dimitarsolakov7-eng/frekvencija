"use client";

import { Archive, Power, PowerOff, X } from "lucide-react";
import { Button } from "@/components/ui";
import { formatCount } from "./track-query";

export type BulkActionKind = "activate" | "deactivate" | "remove";

export interface BulkActionBarProps {
  count: number;
  /** The bulk action in flight, if any (its button shows a spinner, the others are disabled). */
  pending: BulkActionKind | null;
  onActivate: () => void;
  onDeactivate: () => void;
  /** Asks for confirmation first (the caller opens the dialog). */
  onRemove: () => void;
  onClear: () => void;
}

/** Actions for the ticked rows: Activate, Deactivate, Remove from playback (confirmed), Clear. */
export function BulkActionBar({ count, pending, onActivate, onDeactivate, onRemove, onClear }: BulkActionBarProps) {
  const busy = pending !== null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-2 rounded-card border border-accent/40 bg-accent/10 px-3 py-2.5 sm:px-4"
    >
      <p className="mr-auto pl-1 text-sm font-semibold text-fg" aria-live="polite">
        {formatCount(count)} selected
      </p>
      <Button
        variant="secondary"
        size="sm"
        icon={<Power aria-hidden="true" />}
        loading={pending === "activate"}
        disabled={busy}
        onClick={onActivate}
      >
        Activate
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon={<PowerOff aria-hidden="true" />}
        loading={pending === "deactivate"}
        disabled={busy}
        onClick={onDeactivate}
      >
        Deactivate
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon={<Archive aria-hidden="true" />}
        loading={pending === "remove"}
        disabled={busy}
        onClick={onRemove}
        className="text-danger!"
      >
        Remove from playback
      </Button>
      <Button variant="ghost" size="sm" icon={<X aria-hidden="true" />} disabled={busy} onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
