"use client";

import { CloudUpload, X } from "lucide-react";
import { Button, FileDropzone, ProgressBar } from "@/components/ui";
import type { UploadPhase } from "@/lib/uploads/client";
import { AUDIO_ACCEPT, MAX_ANNOUNCEMENT_BYTES } from "@/lib/validation/limits";
import { formatBytes } from "@/lib/utils/format";

export interface UploadProgressState {
  name: string;
  phase: UploadPhase;
  /** 0–1 while bytes are transferred. */
  fraction: number;
}

export interface RecordingDropzoneProps {
  progress: UploadProgressState | null;
  error: string | null;
  onFile: (file: File) => void;
  onCancel: () => void;
  disabled?: boolean;
}

const PHASE_LABELS: Record<UploadPhase, string> = {
  signing: "Preparing the upload",
  uploading: "Uploading",
  validating: "Checking the MP3",
};

/** The real per-file limit enforced by the upload routes and the storage bucket. */
export const ANNOUNCEMENT_UPLOAD_LIMIT_LABEL = formatBytes(MAX_ANNOUNCEMENT_BYTES);

/**
 * "Drop an MP3 file here or click to browse" with the configured size limit, upload progress (the
 * transfer can be cancelled until the server starts checking the file) and validation errors.
 */
export function RecordingDropzone({ progress, error, onFile, onCancel, disabled = false }: RecordingDropzoneProps) {
  const cancellable = progress !== null && progress.phase !== "validating";
  return (
    <div className="grid gap-3">
      {progress ? (
        <div className="grid gap-3 rounded-card border border-border bg-control p-4">
          <ProgressBar
            label={`${PHASE_LABELS[progress.phase]} ${progress.name}`}
            showLabel
            showValue={progress.phase === "uploading"}
            value={progress.phase === "uploading" ? Math.round(progress.fraction * 100) : null}
          />
          {cancellable && (
            <div>
              <Button variant="ghost" size="sm" icon={<X aria-hidden="true" />} onClick={onCancel}>
                Cancel upload
              </Button>
            </div>
          )}
        </div>
      ) : (
        <FileDropzone
          label="Drop an MP3 file here"
          description="or click to browse"
          hint={`MP3 only, max ${ANNOUNCEMENT_UPLOAD_LIMIT_LABEL}`}
          accept={AUDIO_ACCEPT}
          icon={<CloudUpload />}
          disabled={disabled}
          onFiles={(files) => {
            const file = files[0];
            if (file) onFile(file);
          }}
          className="py-6"
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
