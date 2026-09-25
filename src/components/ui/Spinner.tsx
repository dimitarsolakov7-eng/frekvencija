import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type SpinnerSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-8",
};

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Text announced to assistive technology. Defaults to "Loading". */
  label?: string;
  /**
   * Hide the spinner from assistive technology, e.g. inside a button that already sets
   * `aria-busy` and keeps its own label.
   */
  decorative?: boolean;
  className?: string;
}

/** Rotating indicator; it stays still (but visible) when the user prefers reduced motion. */
export function Spinner({ size = "md", label = "Loading", decorative = false, className }: SpinnerProps) {
  const icon = (
    <LoaderCircle aria-hidden="true" className={cn("shrink-0 animate-spin text-current", SIZE_CLASSES[size])} />
  );
  if (decorative) {
    return <span className={cn("inline-flex", className)}>{icon}</span>;
  }
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
