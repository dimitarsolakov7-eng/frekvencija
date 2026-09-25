"use client";

import { useEffect, useRef, useState } from "react";
import { FileAudio, Upload, X } from "lucide-react";
import { Alert, Button, Dialog, FileDropzone, ProgressBar } from "@/components/ui";
import type { AdminTrack, CompleteUploadResponse } from "@/lib/api/contracts";
import { buildSignUploadRequest, isUploadAbort, UploadError, type UploadPhase } from "@/lib/uploads/client";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { AUDIO_ACCEPT, checkUploadFile, MAX_TRACK_BYTES } from "@/lib/validation/limits";
import type { CatalogServices } from "./services";

export interface TrackReplaceDialogProps {
  open: boolean;
  track: AdminTrack;
  upload: CatalogServices["upload"];
  onClose: () => void;
  /** Called once the new audio is stored and validated (the caller closes the dialog and refreshes). */
  onReplaced: (response: CompleteUploadResponse) => void;
}

type Stage = "idle" | UploadPhase;

const STAGE_TEXT: Record<UploadPhase, string> = {
  signing: "Preparing upload…",
  uploading: "Uploading…",
  validating: "Checking the MP3 on the server…",
};

/**
 * Replace a track's audio (upload kind "track-replace"): the server validates the new MP3, points the
 * track at it and only then deletes the old file. Title, artist and genres are kept.
 * Remount (key) per opening to start fresh.
 */
export function TrackReplaceDialog({ open, track, upload, onClose, onReplaced }: TrackReplaceDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const busy = stage !== "idle";
  const stageText = stage === "idle" ? null : STAGE_TEXT[stage];
  const cancellable = stage === "signing" || stage === "uploading";

  // Unmounting mid-transfer aborts it (validation, once started, still finishes on the server).
  useEffect(() => () => controllerRef.current?.abort(), []);

  function chooseFile(files: File[]) {
    const next = files[0];
    if (!next) return;
    const check = checkUploadFile("track-replace", next);
    setFile(check.ok ? next : null);
    setProblem(check.ok ? null : check.message);
  }

  async function start() {
    if (!file || busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setProblem(null);
    setProgress(0);
    setStage("signing");
    try {
      const response = await upload({
        request: buildSignUploadRequest({ kind: "track-replace", trackId: track.id }, file),
        file,
        signal: controller.signal,
        onPhase: setStage,
        onProgress: setProgress,
      });
      controllerRef.current = null;
      setStage("idle");
      onReplaced(response);
    } catch (error) {
      controllerRef.current = null;
      setStage("idle");
      if (isUploadAbort(error)) {
        setProblem("Upload cancelled. The current audio was not changed.");
      } else if (error instanceof UploadError) {
        setProblem(error.message);
      } else {
        console.error("[admin/music] replace upload failed", error);
        setProblem("The upload failed unexpectedly. The current audio was not changed. Please try again.");
      }
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title={`Replace the file of “${track.title}”`}
      description="Title, artist and genres stay the same; duration and file details are read from the new file."
      footer={
        <>
          {cancellable ? (
            <Button variant="secondary" icon={<X aria-hidden="true" />} onClick={() => controllerRef.current?.abort()}>
              Cancel upload
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Close
            </Button>
          )}
          <Button
            icon={<Upload aria-hidden="true" />}
            onClick={() => void start()}
            loading={busy}
            loadingText={stageText ?? undefined}
            disabled={!file}
          >
            Upload and replace
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-control border border-border bg-control px-4 py-3 text-sm">
          <dt className="text-fg-muted">Current file</dt>
          <dd className="truncate text-fg" title={track.originalFilename ?? undefined}>
            {track.originalFilename ?? "Unknown file name"}
          </dd>
          <dt className="text-fg-muted">Length</dt>
          <dd className="text-fg tabular-nums">{formatDuration(track.durationSeconds)}</dd>
          <dt className="text-fg-muted">Size</dt>
          <dd className="text-fg tabular-nums">
            {formatBytes(track.fileSizeBytes)}
            {track.bitrateKbps ? ` · ${track.bitrateKbps} kbps` : ""}
          </dd>
        </dl>

        <Alert
          tone="info"
          title="What venues hear"
          description="A venue playing this track right now keeps playing it; the new audio is used from the next time the track starts. The old file is deleted once the new one has been checked."
        />

        <FileDropzone
          label={file ? "Choose a different MP3" : "Choose the new MP3"}
          description="or drag and drop it here"
          hint="MP3 audio"
          accept={AUDIO_ACCEPT}
          maxSizeBytes={MAX_TRACK_BYTES}
          icon={<FileAudio />}
          disabled={busy}
          onFiles={chooseFile}
        />

        {file && (
          <p className="text-sm text-fg">
            Selected: <span className="font-medium">{file.name}</span> <span className="text-fg-muted">({formatBytes(file.size)})</span>
          </p>
        )}

        {stageText && (
          <ProgressBar
            label={stageText}
            showLabel
            showValue={stage === "uploading"}
            value={stage === "uploading" ? progress * 100 : null}
          />
        )}

        {problem && <Alert tone="danger" title="Not replaced" description={problem} />}
      </div>
    </Dialog>
  );
}
