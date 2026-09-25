import { Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import type { PrimaryActionKind } from "./player-view";

/** Icon matching the main button's current action (decorative: the label carries the meaning). */
export function PrimaryActionIcon({ kind, className }: { kind: PrimaryActionKind; className?: string }) {
  switch (kind) {
    case "pause":
      return <Pause aria-hidden="true" className={className} fill="currentColor" />;
    case "retry":
      return <RotateCcw aria-hidden="true" className={className} />;
    case "unblock":
      return <Volume2 aria-hidden="true" className={className} />;
    case "start":
    case "resume":
    case "none":
      return <Play aria-hidden="true" className={className} fill="currentColor" />;
  }
}
