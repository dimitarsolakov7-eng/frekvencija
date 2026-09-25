"use client";

import { useId, useState, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatBytes } from "@/lib/utils/format";

export interface FileDropzoneProps {
  /**
   * Receives the chosen or dropped files. Dropped files bypass `accept` and size limits, so
   * validate them here (see `fileMatchesAccept` in @/lib/utils) and report problems to the user.
   */
  onFiles: (files: File[]) => void;
  /** Accessible name and main text, e.g. "Choose MP3 files". */
  label: string;
  /** Secondary text, e.g. "or drag and drop them here". */
  description?: ReactNode;
  /** Short format hint, e.g. "MP3 audio". Combined with the size limit. */
  hint?: ReactNode;
  /** Passed to the file input, e.g. ".mp3,audio/mpeg". */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Shown as "up to 50 MB per file"; enforcement is the caller's (and the server's) job. */
  maxSizeBytes?: number;
  icon?: ReactNode;
  id?: string;
  className?: string;
}

function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * Presentational file picker: click (or Enter/Space on the focused input) opens the OS dialog and
 * files can be dragged onto the zone. It never uploads anything itself.
 */
export function FileDropzone({
  onFiles,
  label,
  description = "or drag and drop here",
  hint,
  accept,
  multiple = false,
  disabled = false,
  maxSizeBytes,
  icon,
  id,
  className,
}: FileDropzoneProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}file`;
  const descriptionId = `${inputId}-description`;
  // Counts nested dragenter/dragleave pairs so hovering child elements does not flicker.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0 && !disabled;

  const sizeHint =
    maxSizeBytes !== undefined
      ? `${hint ? "up to" : "Up to"} ${formatBytes(maxSizeBytes)}${multiple ? " per file" : ""}`
      : null;

  function deliver(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <label
      htmlFor={inputId}
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        setDragDepth((depth) => Math.max(0, depth - 1));
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragDepth(0);
        if (!disabled) deliver(event.dataTransfer.files);
      }}
      className={cn(
        "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed",
        "border-border-strong bg-control px-6 py-8 text-center transition-colors duration-150",
        "hover:border-accent/60 hover:bg-surface-2",
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
        "data-dragging:border-accent data-dragging:bg-accent/10",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:border-border-strong data-disabled:hover:bg-control",
        className,
      )}
    >
      <input
        id={inputId}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        aria-describedby={descriptionId}
        onChange={(event) => {
          const input = event.currentTarget;
          deliver(input.files);
          // Allow picking the same file again (e.g. after fixing a rejected upload).
          input.value = "";
        }}
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex size-12 items-center justify-center rounded-full [&_svg]:size-6",
          dragging ? "bg-accent/15 text-accent-text" : "bg-surface-2 text-fg-muted",
        )}
      >
        {icon ?? <Upload />}
      </span>
      <span className="text-base font-medium text-fg">{label}</span>
      <span id={descriptionId} className="grid gap-1">
        {description && <span className="text-sm text-fg-muted">{description}</span>}
        {(hint || sizeHint) && (
          <span className="text-xs text-fg-subtle">
            {hint}
            {hint && sizeHint ? " · " : null}
            {sizeHint}
          </span>
        )}
      </span>
    </label>
  );
}
