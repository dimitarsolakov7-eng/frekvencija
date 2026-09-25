import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { BUTTON_VARIANT_CLASSES, type ButtonVariant } from "./button-styles";
import { Spinner } from "./Spinner";

export type IconButtonSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: "size-9 [&_svg]:size-4",
  md: "size-11 [&_svg]:size-5",
  lg: "size-14 [&_svg]:size-6",
  xl: "size-20 [&_svg]:size-8",
};

export interface IconButtonProps extends Omit<ComponentPropsWithRef<"button">, "children" | "aria-label"> {
  /** Required accessible name, also shown as the native tooltip unless `title` is given. */
  "aria-label": string;
  /** The icon element (lucide-react icons are hidden from assistive technology automatically). */
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: IconButtonSize;
  /** Circular instead of rounded-square. */
  round?: boolean;
  loading?: boolean;
}

/**
 * Square icon-only button. For toggles that keep their label (e.g. Mute) pass `aria-pressed`;
 * for buttons whose label changes (Play/Pause) change `aria-label` instead.
 */
export function IconButton({
  icon,
  variant = "ghost",
  size = "md",
  round = false,
  loading = false,
  disabled,
  className,
  type = "button",
  title,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      title={title ?? props["aria-label"]}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition-colors duration-150 [&_svg]:shrink-0",
        "disabled:pointer-events-none disabled:opacity-50",
        round ? "rounded-full" : size === "xl" ? "rounded-card" : "rounded-control",
        BUTTON_VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
    >
      {loading ? <Spinner decorative size={size === "sm" ? "sm" : size === "md" ? "md" : "lg"} /> : icon}
    </button>
  );
}
