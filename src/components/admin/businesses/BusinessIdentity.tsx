"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2, X } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  CoverImage,
  DropdownMenu,
  ProgressBar,
  StatusPill,
  useToast,
} from "@/components/ui";
import type { AdminBusinessRecord } from "@/lib/data/admin/businesses";
import { isUploadAbort, UploadError, type UploadPhase } from "@/lib/uploads/client";
import { checkUploadFile, IMAGE_ACCEPT } from "@/lib/validation/limits";
import type { BusinessDetailActions } from "./action-types";
import { useBusinessMenuItems } from "./BusinessActionDialogs";
import { businessTypeLabel } from "./business-form";
import type { BusinessStatusView } from "./business-status";
import type { LogoUploader } from "./logo-upload";

export interface BusinessIdentityProps {
  business: Pick<AdminBusinessRecord, "id" | "name" | "stationName" | "businessType" | "isActive" | "logoPath">;
  logoUrl: string | null;
  status: BusinessStatusView;
  memberCount: number;
  memberEmails: readonly string[];
  removeBusinessLogo: BusinessDetailActions["removeBusinessLogo"];
  uploadLogo: LogoUploader;
}

interface UploadProgress {
  fileName: string;
  phase: UploadPhase;
  /** 0–1 while uploading. */
  fraction: number;
}

function progressLabel(upload: UploadProgress): string {
  switch (upload.phase) {
    case "signing":
      return `Preparing ${upload.fileName}…`;
    case "uploading":
      return `Uploading ${upload.fileName}`;
    case "validating":
      return `Checking ${upload.fileName}…`;
  }
}

/**
 * Top of the Profile tab (screen 06): the venue's logo (upload, replace, remove — applied at once,
 * not part of Save), its name, type and status, and the venue's "…" menu.
 */
export function BusinessIdentity({
  business,
  logoUrl,
  status,
  memberCount,
  memberEmails,
  removeBusinessLogo,
  uploadLogo,
}: BusinessIdentityProps) {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The freshly uploaded logo, shown until the refreshed page carries its own signed URL.
  const [uploaded, setUploaded] = useState<{ path: string; url: string; replacing: string | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const menuItems = useBusinessMenuItems(
    { id: business.id, name: business.name, isActive: business.isActive, memberCount, memberEmails },
    { includeOpen: false },
  );

  const displayUrl =
    uploaded && (uploaded.path === business.logoPath || uploaded.replacing === business.logoPath) ? uploaded.url : logoUrl;
  const hasLogo = Boolean(business.logoPath) || Boolean(uploaded && uploaded.replacing === business.logoPath);
  const busy = upload !== null;

  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    setError(null);
    const check = checkUploadFile("logo", { name: file.name, size: file.size, type: file.type });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setUpload({ fileName: file.name, phase: "signing", fraction: 0 });
    try {
      const result = await uploadLogo({
        businessId: business.id,
        file,
        signal: controller.signal,
        onPhase: (phase) => setUpload((current) => (current ? { ...current, phase } : current)),
        onProgress: (fraction) => setUpload((current) => (current ? { ...current, fraction } : current)),
      });
      setUploaded({ path: result.logoPath, url: result.logoUrl, replacing: business.logoPath });
      toast.success("Logo updated", { description: "The venue’s player shows the new logo from its next page load." });
      router.refresh();
    } catch (caught) {
      if (isUploadAbort(caught)) {
        toast.info("Upload cancelled");
      } else {
        setError(caught instanceof UploadError ? caught.message : "The logo could not be uploaded. Please try again.");
        if (!(caught instanceof UploadError)) console.error("[admin/businesses] logo upload failed", caught);
      }
    } finally {
      abortRef.current = null;
      setUpload(null);
    }
  }

  async function removeLogo() {
    const result = await removeBusinessLogo(business.id);
    if (result.ok) {
      setUploaded(null);
      setConfirmRemove(false);
      setRemoveError(null);
      toast.success("Logo removed", { description: result.message ?? undefined });
    } else {
      setRemoveError(result.message ?? "The logo could not be removed. Please try again.");
    }
  }

  const cancellable = upload !== null && upload.phase !== "validating";

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-4">
        <CoverImage
          src={displayUrl}
          artworkKey={business.id}
          alt={hasLogo ? `${business.name} logo` : ""}
          sizes="112px"
          className="size-20 shrink-0 rounded-card border border-border @sm:size-28"
        />
        <div className="grid min-w-0 flex-1 gap-1 pt-1">
          {/* Takes focus when the venue opens from the list on a narrow screen (see ./detail-focus). */}
          <h2
            tabIndex={-1}
            data-detail-heading={business.id}
            className="truncate text-2xl font-bold tracking-tight text-fg focus:outline-none @sm:text-[1.75rem]"
          >
            {business.name}
          </h2>
          <p className="text-fg-muted">{businessTypeLabel(business.businessType)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill tone={status.tone} label={status.label} size="sm" />
            <span className="text-sm text-fg-muted">{status.detail}</span>
          </div>
        </div>
        <DropdownMenu label={`More actions for ${business.name}`} items={menuItems} className="-mt-1 -mr-2 shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void handleFile(file);
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          icon={<ImageUp aria-hidden="true" />}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {hasLogo ? "Replace logo" : "Upload logo"}
        </Button>
        {hasLogo && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 aria-hidden="true" />}
            disabled={busy}
            className="text-danger"
            onClick={() => {
              setRemoveError(null);
              setConfirmRemove(true);
            }}
          >
            Remove logo
          </Button>
        )}
        <span className="text-xs text-fg-muted">PNG, JPEG or WebP, up to 2 MB. Applied immediately.</span>
      </div>

      {upload && (
        <div className="grid gap-2 rounded-control border border-border bg-control p-3">
          <ProgressBar
            label={progressLabel(upload)}
            showLabel
            size="sm"
            showValue={upload.phase === "uploading"}
            value={upload.phase === "uploading" ? upload.fraction * 100 : null}
          />
          {cancellable && (
            <Button
              variant="ghost"
              size="sm"
              icon={<X aria-hidden="true" />}
              className="justify-self-start"
              onClick={() => abortRef.current?.abort()}
            >
              Cancel upload
            </Button>
          )}
        </div>
      )}
      {error && <Alert tone="danger" title="The logo was not uploaded" description={error} />}

      <ConfirmDialog
        open={confirmRemove}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={removeLogo}
        title="Remove the logo?"
        description="The image file is deleted and the venue’s player shows the station’s initials instead. You can upload a new logo at any time."
        confirmLabel="Remove logo"
      >
        {removeError ? <Alert tone="danger" description={removeError} /> : null}
      </ConfirmDialog>
    </div>
  );
}
