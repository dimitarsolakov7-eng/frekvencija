import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Minimal shape of a Server Action result this component can display. */
export interface FormMessageState {
  ok: boolean;
  message?: string | null;
}

export interface FormMessageProps {
  /** Action state from useActionState; nothing is shown while `message` is empty. */
  state?: FormMessageState | null;
  /** Explicit message (takes precedence over `state`). */
  message?: string | null;
  tone?: "success" | "error";
  className?: string;
}

/**
 * Form-level result message ("Saved", "Could not save: …"). The polite live region is always
 * rendered, so the message is announced when it appears after submission.
 */
export function FormMessage({ state, message, tone, className }: FormMessageProps) {
  const text = (message ?? state?.message ?? "").trim();
  const resolvedTone = tone ?? (state?.ok ? "success" : "error");
  const Icon = resolvedTone === "success" ? CircleCheck : CircleAlert;

  return (
    <div aria-live="polite" aria-atomic="true" className={cn(!text && "sr-only", className)}>
      {text && (
        <p
          className={cn(
            "flex items-start gap-2 rounded-control border px-3 py-2.5 text-sm",
            resolvedTone === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger",
          )}
        >
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="text-fg">{text}</span>
        </p>
      )}
    </div>
  );
}
