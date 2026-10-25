"use client";

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";

export interface RevealProps {
  children: ReactNode;
  /** Wrapper element. Default div. */
  as?: ElementType;
  className?: string;
  /** Stagger within a group, in milliseconds. */
  delay?: number;
  id?: string;
}

/**
 * Section reveal of the public website. The content renders visible; after hydration, an element
 * that is still below the fold is hidden and animated in when it scrolls into view. People who ask
 * for reduced motion, browsers without IntersectionObserver and visitors without JavaScript all see
 * the content immediately. Styles: `[data-reveal]` in globals.css.
 */
export function Reveal({ children, as: Tag = "div", className, delay = 0, id }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = element.getBoundingClientRect();
    // Already on screen: leave it as it is (no flash of hidden content).
    if (rect.top < window.innerHeight * 0.92) return;

    element.dataset.reveal = "pending";
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      element.dataset.reveal = "in";
      cleanup();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) show();
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    // Belt and braces: IntersectionObserver only reports while the document is being rendered, so a
    // plain position check on scroll/resize (and when the tab becomes visible again) makes sure
    // nothing stays hidden in a background tab or an unusual browser.
    const check = () => {
      if (element.getBoundingClientRect().top < window.innerHeight * 0.96) show();
    };
    const cleanup = () => {
      observer.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      document.removeEventListener("visibilitychange", check);
    };
    observer.observe(element);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    document.addEventListener("visibilitychange", check);
    return cleanup;
  }, []);

  const style: CSSProperties | undefined = delay > 0 ? { animationDelay: `${delay}ms` } : undefined;
  return (
    <Tag ref={ref} id={id} className={className} style={style}>
      {children}
    </Tag>
  );
}
