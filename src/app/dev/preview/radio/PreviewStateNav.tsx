import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { PREVIEW_STATES, PREVIEW_STATE_LABELS, type PreviewStateName } from "./fixtures";

/** Development-only switcher between the fixture states of the radio preview. */
export function PreviewStateNav({ current }: { current: PreviewStateName }) {
  return (
    <nav aria-label="Preview states" className="mb-6 rounded-card border border-warning/30 bg-surface p-3 lg:mb-8">
      <p className="mb-2 px-1 text-xs font-semibold tracking-[0.14em] text-warning uppercase">Design preview · fixture data</p>
      <ul className="flex flex-wrap gap-1.5">
        {PREVIEW_STATES.map((state) => (
          <li key={state}>
            <Link
              href={`/dev/preview/radio?state=${state}` as Route}
              aria-current={state === current ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-control border px-3 text-sm font-medium transition-colors",
                state === current
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-border bg-control text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              {PREVIEW_STATE_LABELS[state]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
