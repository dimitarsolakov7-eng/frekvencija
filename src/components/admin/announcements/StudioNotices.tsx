import { CloudUpload, Mic } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";

export interface TtsUnavailableCardProps {
  /** Server-side explanation (e.g. the key is missing or was rejected), shown under "Setup details". */
  reason: string | null;
  onUploadInstead: () => void;
}

/** "Generate voice" when text-to-speech is not set up: says so plainly and points to uploading. */
export function TtsUnavailableCard({ reason, onUploadInstead }: TtsUnavailableCardProps) {
  return (
    <Card className="grid grid-cols-1 gap-4 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted [&_svg]:size-5"
        >
          <Mic />
        </span>
        <div className="grid gap-1">
          <h2 className="section-title font-bold text-fg">The AI voice isn&apos;t set up yet</h2>
          <p className="text-sm text-fg-muted text-pretty">
            Generating a voice needs the text-to-speech integration on the server. Until then, upload your own MP3 recordings — they are
            approved and played exactly the same way.
          </p>
        </div>
      </div>
      {reason && (
        <details className="rounded-control border border-border bg-control px-3 py-2 text-sm text-fg-muted">
          <summary className="cursor-pointer font-medium text-fg">Setup details</summary>
          <p className="mt-2 text-pretty">{reason}</p>
        </details>
      )}
      <div>
        <Button icon={<CloudUpload aria-hidden="true" />} onClick={onUploadInstead}>
          Upload recording
        </Button>
      </div>
    </Card>
  );
}

export interface NeedsReviewBannerProps {
  count: number;
  /** Distinct review reasons (already sentences), at most a few. */
  reasons: readonly string[];
}

/** Shown while recordings are off air because the venue's branding changed. */
export function NeedsReviewBanner({ count, reasons }: NeedsReviewBannerProps) {
  if (count === 0) return null;
  return (
    <Alert
      tone="warning"
      title={`${count} ${count === 1 ? "recording needs" : "recordings need"} review`}
      description={
        <div className="grid gap-2">
          <p>
            The venue&apos;s name, station name or pronunciation changed, so recordings made with the old branding are off air until you check
            them. Listen to each one and re-approve it, or create a new version.
          </p>
          {reasons.length > 0 && (
            <ul className="list-disc pl-5">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      }
    />
  );
}
