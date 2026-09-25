"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImageIcon, Trash2, X } from "lucide-react";
import { useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import { Alert, Button, CoverImage, ProgressBar } from "@/components/ui";
import type { CompleteUploadResponse } from "@/lib/api/contracts";
import { buildSignUploadRequest, isUploadAbort, UploadError, type UploadPhase } from "@/lib/uploads/client";
import { checkUploadFile, formatBytes, IMAGE_ACCEPT, MAX_GENRE_COVER_BYTES } from "@/lib/validation/limits";
import type { CatalogServices } from "./services";

export interface GenreCoverFieldProps {
  genreId: string;
  genreName: string;
  /** Artwork key for the default artwork (the slug). */
  slug: string;
  /** Signed URL of the current cover, or null (default artwork). */
  coverUrl: string | null;
  hasCover: boolean;
  upload: CatalogServices["upload"];
  /** The new cover is stored, validated and saved on the genre. */
  onUploaded: (cover: { coverPath: string; coverUrl: string }) => void;
  /** Asks to remove the cover (the caller confirms). */
  onRemove: () => void;
  removing?: boolean;
}

type Stage = "idle" | UploadPhase;

const STAGE_TEXT: Record<UploadPhase, string> = {
  signing: "Preparing upload…",
  uploading: "Uploading cover…",
  validating: "Checking the image…",
};

function isCoverResponse(response: CompleteUploadResponse): response is Extract<CompleteUploadResponse, { kind: "genre-cover" }> {
  return response.kind === "genre-cover";
}

/**
 * Cover preview with "Change cover" (PNG, JPEG or WebP up to 3 MB: checked in the browser, then by
 * content on the server, which saves it on the genre and deletes the previous file) and
 * "Remove cover". Remount (key) per genre so an upload never continues into another genre's editor.
 */
export function GenreCoverField({
  genreId,
  genreName,
  slug,
  coverUrl,
  hasCover,
  upload,
  onUploaded,
  onRemove,
  removing = false,
}: GenreCoverFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const busy = stage !== "idle";
  const cancellable = stage === "signing" || stage === "uploading";

  useEffect(() => () => controllerRef.current?.abort(), []);
  // Leaving the page cancels a transfer still in progress (a file being checked still finishes).
  useUnsavedChangesGuard(cancellable, {
    message: `The new cover for “${genreName}” is still uploading. If you leave this page, the upload is cancelled.`,
  });

  async function start(file: File) {
    const check = checkUploadFile("genre-cover", file);
    if (!check.ok) {
      setProblem(check.message);
      setStatus("");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setProblem(null);
    setStatus("");
    setProgress(0);
    setStage("signing");
    try {
      const response = await upload({
        request: buildSignUploadRequest({ kind: "genre-cover", genreId }, file),
        file,
        signal: controller.signal,
        onPhase: setStage,
        onProgress: setProgress,
      });
      controllerRef.current = null;
      setStage("idle");
      if (!isCoverResponse(response)) throw new UploadError("server_error", "The server returned an unexpected response. Refresh the page.");
      setStatus("New cover saved.");
      onUploaded({ coverPath: response.coverPath, coverUrl: response.coverUrl });
    } catch (error) {
      controllerRef.current = null;
      setStage("idle");
      if (isUploadAbort(error)) setProblem("Upload cancelled. The cover was not changed.");
      else if (error instanceof UploadError) setProblem(error.message);
      else {
        console.error("[admin/genres] cover upload failed", error);
        setProblem("The upload failed unexpectedly. The cover was not changed. Please try again.");
      }
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (file) void start(file);
  }

  return (
    <div className="grid gap-3">
      <CoverImage
        src={coverUrl}
        artworkKey={slug}
        alt={hasCover ? `Cover of ${genreName}` : ""}
        sizes="(min-width: 1280px) 22rem, (min-width: 1024px) 18rem, 100vw"
        className="aspect-[16/9] rounded-card border border-border"
      />
      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} onChange={handleInput} className="hidden" tabIndex={-1} aria-hidden="true" />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={<ImageIcon aria-hidden="true" />}
          onClick={() => inputRef.current?.click()}
          loading={busy}
          loadingText={stage === "idle" ? undefined : STAGE_TEXT[stage]}
          disabled={removing}
          className="flex-1"
        >
          Change cover
        </Button>
        {cancellable && (
          <Button variant="outline" icon={<X aria-hidden="true" />} onClick={() => controllerRef.current?.abort()}>
            Cancel
          </Button>
        )}
        {hasCover && !busy && (
          <Button variant="ghost" icon={<Trash2 aria-hidden="true" />} onClick={onRemove} loading={removing} loadingText="Removing…">
            Remove cover
          </Button>
        )}
      </div>
      {stage === "uploading" && <ProgressBar label="Uploading cover" showValue value={progress * 100} size="sm" />}
      {(stage === "signing" || stage === "validating") && <ProgressBar label={STAGE_TEXT[stage]} value={null} size="sm" />}
      <p className="text-sm text-fg-muted">
        Upload a cover image for this genre. PNG, JPEG or WebP, up to {formatBytes(MAX_GENRE_COVER_BYTES)}.
      </p>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      {problem && <Alert tone="danger" title="Cover not changed" description={problem} />}
    </div>
  );
}
