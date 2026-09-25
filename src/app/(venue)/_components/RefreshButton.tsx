"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";

/** Re-renders the current route on the server (e.g. after the station failed to load). */
export function RefreshButton({ label = "Try again" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="lg"
      icon={<RotateCcw aria-hidden="true" />}
      loading={pending}
      loadingText="Loading…"
      onClick={() => startTransition(() => router.refresh())}
    >
      {label}
    </Button>
  );
}
