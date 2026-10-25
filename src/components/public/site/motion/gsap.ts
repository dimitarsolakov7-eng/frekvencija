/**
 * GSAP for the public website, registered once. Import from here (not from "gsap" directly) in client
 * components, so the plugins are always registered. GSAP and its plugins (ScrollTrigger, SplitText) are
 * free for commercial use since 3.13 under the GSAP standard license.
 */
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);
  gsap.config({ nullTargetWarn: false });
  // Mobile browsers resize the viewport when their toolbars slide; don't recompute every trigger then.
  ScrollTrigger.config({ ignoreMobileResize: true });
}

export { gsap, ScrollTrigger, SplitText, useGSAP };

/** Full motion. Everything animated lives in a gsap.matchMedia() branch with this query. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
/** Large screens with a precise pointer and motion allowed: pinning, cursor effects. */
export const DESKTOP_MOTION = "(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
/** Shared easing of entrances. */
export const EASE_OUT = "expo.out";
