import { INTRO_DONE_EVENT } from "./boot";

/** True while the first-visit intro overlay is showing (browser only). */
export function introPlaying(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("intro-on");
}

/**
 * Runs `callback` once the intro has started lifting — immediately when no intro plays. A safety timer
 * makes sure the hero always animates in. Returns a cleanup function.
 */
export function onIntroDone(callback: () => void): () => void {
  if (!introPlaying()) {
    callback();
    return () => undefined;
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    callback();
  };
  window.addEventListener(INTRO_DONE_EVENT, run, { once: true });
  const timer = window.setTimeout(run, 6000);
  return () => {
    window.removeEventListener(INTRO_DONE_EVENT, run);
    window.clearTimeout(timer);
  };
}
