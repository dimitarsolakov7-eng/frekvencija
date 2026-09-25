"use client";

import { useEffect } from "react";
import { House, RotateCcw } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button, ButtonLink } from "@/components/ui/Button";

interface ErrorPageProps {
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the failed segment (stable since Next.js 16.3). */
  retry: () => void;
}

export default function ErrorPage({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    // Surfaces the full error in the browser console; server errors also carry a digest that
    // matches the server log entry.
    console.error(error);
  }, [error]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex flex-1 flex-col items-center justify-center gap-10 px-page py-16 text-center focus:outline-none"
    >
      <BrandLogo tone="ivory" size="lg" />
      <div className="grid max-w-md gap-3">
        <h1 className="page-title text-fg">Something went wrong</h1>
        <p className="text-fg-muted text-pretty">
          This page could not be loaded. It is often a temporary connection problem, so trying again usually
          helps. If it keeps happening, contact your administrator.
        </p>
        {error.digest && (
          <p className="text-sm text-fg-subtle">
            Reference: <code className="font-mono text-fg-muted">{error.digest}</code>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" icon={<RotateCcw aria-hidden="true" />} onClick={() => retry()}>
          Try again
        </Button>
        <ButtonLink href="/" size="lg" variant="secondary" icon={<House aria-hidden="true" />}>
          Go to the start page
        </ButtonLink>
      </div>
    </main>
  );
}
