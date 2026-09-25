"use client";

import { useEffect } from "react";
import { Radio, RotateCcw } from "lucide-react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";

interface VenueErrorProps {
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the failed segment (stable since Next.js 16.3). */
  retry: () => void;
}

/**
 * Error boundary for venue pages. It renders inside the venue layout, so the app shell and the
 * persistent player (and any music that is playing) stay alive while one page has failed.
 */
export default function VenueError({ error, retry }: VenueErrorProps) {
  useEffect(() => {
    // The full error goes to the browser console; server errors carry a digest matching the server log.
    console.error(error);
  }, [error]);

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeading title="Something went wrong" description="This page could not be loaded." className="pb-0" />
      <Alert
        tone="danger"
        title="The page didn’t load"
        description="This is usually a temporary connection problem. Your radio keeps playing in the bar below. Try again; if it keeps happening, contact your administrator."
        action={
          <Button icon={<RotateCcw aria-hidden="true" />} onClick={() => retry()}>
            Try again
          </Button>
        }
      />
      {error.digest && (
        <p className="text-sm text-fg-muted">
          Reference for support: <code className="font-mono text-fg">{error.digest}</code>
        </p>
      )}
      <div>
        <ButtonLink href="/radio" variant="secondary" icon={<Radio aria-hidden="true" />}>
          Go to your radio
        </ButtonLink>
      </div>
    </div>
  );
}
