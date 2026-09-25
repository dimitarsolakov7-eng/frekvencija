import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width. */
  fullWidth?: boolean;
}

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-semibold " +
  "transition-colors duration-150 [&_svg]:shrink-0 " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/**
 * primary: solid emerald with dark text (≈7.5:1). secondary: quiet raised well with a hairline
 * border ("Manage tracks", "Change cover"). outline: transparent with a stronger border ("Save
 * settings", "Cancel"). ghost: text-only. danger: solid red for confirmed destructive actions.
 */
export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active",
  secondary:
    "border border-border bg-control text-fg hover:border-border-strong hover:bg-surface-2 active:bg-surface-3",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg active:bg-surface-3",
  danger: "bg-danger-solid text-white hover:bg-danger-solid-hover",
  outline: "border border-border-strong text-fg hover:bg-surface-2 active:bg-surface-3",
};

/** Heights: sm 36px, md 44px (minimum comfortable touch target), lg 48px, xl 64px (hero actions). */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-9 rounded-control px-3 text-sm [&_svg]:size-4",
  md: "h-11 rounded-control px-4 text-[0.9375rem] [&_svg]:size-[1.125rem]",
  lg: "h-12 rounded-control px-5 text-base [&_svg]:size-5",
  xl: "h-16 rounded-card px-8 text-lg [&_svg]:size-6",
};

/** Class list shared by <Button>, <ButtonLink> and anything that must look like a button. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: ButtonStyleProps & { className?: string } = {}): string {
  return cn(BASE, BUTTON_VARIANT_CLASSES[variant], SIZE_CLASSES[size], fullWidth && "w-full", className);
}
