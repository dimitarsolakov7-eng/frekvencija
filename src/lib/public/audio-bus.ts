/**
 * One sample at a time: every sample player on the public website announces when it starts, and the
 * others pause. A window event keeps the players independent of each other (no shared provider).
 * Client-only; the functions are no-ops when `window` is missing.
 */
const EVENT = "frekvencija:sample-play";

interface SamplePlayDetail {
  id: string;
}

export function announceSamplePlayback(id: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SamplePlayDetail>(EVENT, { detail: { id } }));
}

/** Calls `onOther` whenever a sample other than `id` starts. Returns the unsubscribe function. */
export function subscribeToOtherSamples(id: string, onOther: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SamplePlayDetail>).detail;
    if (detail?.id !== id) onOther();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
