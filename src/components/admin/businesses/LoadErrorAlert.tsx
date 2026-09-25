"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";

/** Honest "couldn't load" state with a Try again button that re-fetches the page's server data. */
export function LoadErrorAlert({ title, description }: { title: string; description?: string }) {
  const router = useRouter();
  return (
    <Alert
      tone="danger"
      title={title}
      description={description ?? "The database didn’t answer as expected. Nothing was changed. Try again in a moment."}
      action={
        <Button variant="secondary" size="sm" icon={<RotateCcw aria-hidden="true" />} onClick={() => router.refresh()}>
          Try again
        </Button>
      }
    />
  );
}
