/**
 * Motion boot for the public website. A tiny inline script in the root <head> (src/app/layout.tsx)
 * runs before the first paint:
 * - with motion allowed it adds `motion` to <html>, so elements marked `data-anim` start hidden and
 *   GSAP reveals them (no flash of content before its entrance);
 * - on a first visit to the homepage (once per tab) it adds `intro-on`, which shows the intro overlay;
 * - if the page has not hydrated after 5 seconds (slow device, script error), it removes both classes
 *   again, so the content is never left hidden.
 * With reduced motion, or without JavaScript, nothing is hidden and no intro plays.
 */

/** sessionStorage key: the intro already played in this tab. */
export const INTRO_SEEN_KEY = "frk-intro";

/** Window event fired when the intro starts lifting (the hero then animates in). */
export const INTRO_DONE_EVENT = "frekvencija:intro-done";

/** Class set on <html> by <MotionProvider> once the motion layer is running. */
export const MOTION_READY_CLASS = "motion-ready";

export const MOTION_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.classList.add("motion");var seen=false;try{seen=window.sessionStorage.getItem("${INTRO_SEEN_KEY}")==="1"}catch(e){}if(location.pathname==="/"&&!location.hash&&!seen)d.classList.add("intro-on");setTimeout(function(){if(!d.classList.contains("${MOTION_READY_CLASS}")){d.classList.remove("motion");d.classList.remove("intro-on")}},5000)}catch(e){}})();`;
