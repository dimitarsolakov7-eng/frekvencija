/**
 * Client-side wrapper for calling a Server Action from an event handler or transition.
 * Expected failures come back as ActionState; this only covers the unexpected ones (network down,
 * server crash), which would otherwise surface as an unhandled rejection.
 */
import { actionError, type ActionState } from "@/lib/actions/state";

const UNREACHABLE_MESSAGE = "The server couldn't complete the request. Check your connection and try again.";

/** Next.js navigation signals (redirect/notFound) carry a `digest`; the router handles them itself. */
function isNavigationSignal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

function isActionState(value: unknown): value is ActionState {
  return !!value && typeof value === "object" && typeof (value as { ok?: unknown }).ok === "boolean";
}

/**
 * Runs the action and returns its state, an error state when the call itself failed, or null when
 * there is nothing to show (the action redirected, e.g. because the session expired).
 */
export async function callAction(run: () => Promise<ActionState>): Promise<ActionState | null> {
  try {
    const result = await run();
    return isActionState(result) ? result : null;
  } catch (error) {
    if (isNavigationSignal(error)) return null;
    console.error("[admin] server action failed", error);
    return actionError(UNREACHABLE_MESSAGE);
  }
}
