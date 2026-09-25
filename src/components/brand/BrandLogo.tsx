import Image from "next/image";
import { PLATFORM_NAME } from "@/config/platform";
import { cn } from "@/lib/utils/cn";

/**
 * The approved Frekvencija logo (green f/equaliser emblem + lowercase wordmark), never with a domain
 * suffix. `tone="ivory"` is the dark-interface variant (ivory wordmark), `tone="dark"` is for light
 * backgrounds. Generated from design/assets by `npm run brand:assets`.
 */
const LOGOS = {
  ivory: { src: "/brand/frekvencija-logo-ivory.png", width: 1200, height: 274 },
  dark: { src: "/brand/frekvencija-logo-dark.png", width: 1200, height: 274 },
} as const;

const HEIGHTS = { sm: "h-6", md: "h-8", lg: "h-10", xl: "h-14" } as const;

export interface BrandLogoProps {
  tone?: keyof typeof LOGOS;
  size?: keyof typeof HEIGHTS;
  /** Above-the-fold logo (hero / sidebar): load eagerly with high fetch priority instead of lazily. */
  priority?: boolean;
  className?: string;
}

export function BrandLogo({ tone = "ivory", size = "md", priority = false, className }: BrandLogoProps) {
  const logo = LOGOS[tone];
  return (
    <Image
      src={logo.src}
      width={logo.width}
      height={logo.height}
      alt={PLATFORM_NAME}
      loading={priority ? "eager" : undefined}
      fetchPriority={priority ? "high" : undefined}
      sizes="(max-width: 640px) 160px, 240px"
      className={cn("w-auto select-none", HEIGHTS[size], className)}
      draggable={false}
    />
  );
}

/** The emblem alone (compact headers, avatars, loading states). Decorative unless `label` is given. */
export function BrandEmblem({ className, label }: { className?: string; label?: string }) {
  return (
    <Image
      src="/brand/frekvencija-emblem.png"
      width={512}
      height={512}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      sizes="48px"
      className={cn("size-8 select-none", className)}
      draggable={false}
    />
  );
}
