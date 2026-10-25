"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { MOTION_READY_CLASS } from "./boot";
import { gsap, ScrollTrigger } from "./gsap";

const LenisContext = createContext<RefObject<Lenis | null>>({ current: null });

/** The smooth-scroll instance (null on touch devices, with reduced motion, or before mount). */
export function useLenisRef(): RefObject<Lenis | null> {
  return useContext(LenisContext);
}

/**
 * The motion layer of the public website. On desktop (fine pointer, motion allowed) it runs Lenis smooth
 * scrolling on GSAP's ticker, so ScrollTrigger and the scroll stay in sync; touch devices keep native
 * scrolling. It marks <html> as motion-ready (see boot.ts) and recomputes every ScrollTrigger once fonts
 * and images have loaded and after each navigation. If the visitor turns on reduced motion while the
 * page is open, the hidden-until-revealed state is dropped at once.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    let tick: ((time: number) => void) | null = null;

    if (!reduce.matches && finePointer) {
      const lenis = new Lenis({
        autoRaf: false,
        duration: 1.1,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        stopInertiaOnNavigate: true,
      });
      lenis.on("scroll", ScrollTrigger.update);
      tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      lenisRef.current = lenis;
    }
    root.classList.add(MOTION_READY_CLASS);

    const refresh = () => ScrollTrigger.refresh();
    void document.fonts?.ready.then(refresh);
    window.addEventListener("load", refresh, { once: true });

    const onReduceChange = () => {
      if (!reduce.matches) return;
      root.classList.remove("motion", "intro-on");
      lenisRef.current?.destroy();
      lenisRef.current = null;
    };
    reduce.addEventListener("change", onReduceChange);

    return () => {
      reduce.removeEventListener("change", onReduceChange);
      window.removeEventListener("load", refresh);
      if (tick) gsap.ticker.remove(tick);
      lenisRef.current?.destroy();
      lenisRef.current = null;
    };
  }, []);

  // Another page: its triggers were created against the old layout.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return <LenisContext.Provider value={lenisRef}>{children}</LenisContext.Provider>;
}
