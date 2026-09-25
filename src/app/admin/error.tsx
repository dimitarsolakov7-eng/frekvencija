"use client";

import { useEffect } from "react";
import { Music, RotateCcw } from "lucide-react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";

interface AdminErrorProps {
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the failed segment (stable since Next.js 16.3). */
  retry: () => void;
}

/**
 * Error boundary for admin pages. It renders inside the admin layout, so the sidebar, account
 * menu and navigation stay available while one page has failed.
 */
export default function AdminError({ error, retry }: AdminErrorProps) {
  useEffect(() => {
    // The full error goes to the browser console; server errors carry a digest matching the server log.
    console.error(error);
  }, [error]);

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeading title="Something went wrong" description="This page could not be loaded." />
      <Alert
        tone="danger"
        title="The page didn’t load"
        description="This is often a temporary connection or service problem, and nothing was changed. Try again; if it keeps happening, check the integration status in Settings."
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
        <ButtonLink href="/admin/music" variant="secondary" icon={<Music aria-hidden="true" />}>
          Go to the music library
        </ButtonLink>
      </div>
    </div>
  );
}
