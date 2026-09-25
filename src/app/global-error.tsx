"use client";

// global-error replaces the root layout, so it brings its own document and global styles.
import "./globals.css";
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/Button";
import { PLATFORM_NAME } from "@/config/platform";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-canvas font-sans text-fg antialiased">
        <title>{`Something went wrong · ${PLATFORM_NAME}`}</title>
        <main className="flex flex-1 flex-col items-center justify-center gap-10 px-page py-16 text-center">
          <BrandLogo tone="ivory" size="lg" />
          <div className="grid max-w-md gap-3">
            <h1 className="page-title">{PLATFORM_NAME} hit an unexpected problem</h1>
            <p className="text-fg-muted text-pretty">
              The app could not be displayed. Try again; if the problem continues, reload the page or contact your
              administrator.
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
            {/* A full reload is the most reliable recovery once the root layout itself has failed. */}
            <Button size="lg" variant="secondary" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
