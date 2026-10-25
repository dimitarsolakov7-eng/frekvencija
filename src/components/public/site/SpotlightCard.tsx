"use client";

import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * A feature card whose vermillion glow follows the pointer (CSS variables; no animation library, so it
 * costs nothing on touch screens). Revealed by the surrounding <Reveal items="[data-feature]">.
 */
export function SpotlightCard({ children, className }: SpotlightCardProps) {
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  return (
    <article
      data-feature=""
      data-anim=""
      onPointerMove={onPointerMove}
      className={cn(
        "group spotlight relative isolate overflow-hidden rounded-[28px] border border-border bg-surface transition-[border-color,transform] duration-500 ease-expo hover:border-fg/20 motion-safe:hover:-translate-y-1",
        className,
      )}
    >
      {children}
    </article>
  );
}
