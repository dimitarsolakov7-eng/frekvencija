import type { ComponentProps, ComponentPropsWithRef, ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { buttonClasses, type ButtonStyleProps } from "./button-styles";
import { Spinner } from "./Spinner";

export interface ButtonProps extends ComponentPropsWithRef<"button">, ButtonStyleProps {
  /** Shows a spinner, sets aria-busy and disables the button while keeping its label. */
  loading?: boolean;
  /** Optional replacement label while loading, e.g. "Saving…". */
  loadingText?: ReactNode;
  /** Icon before the label (replaced by the spinner while loading). Mark it aria-hidden. */
  icon?: ReactNode;
  /** Icon after the label. */
  iconRight?: ReactNode;
}

/**
 * The standard button. Defaults to `type="button"` so it never submits a form by accident; use
 * `type="submit"` or <SubmitButton> inside forms.
 */
export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingText,
  icon,
  iconRight,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
    >
      {loading ? <Spinner decorative size={size === "xl" ? "md" : "sm"} /> : icon}
      {loading && loadingText !== undefined ? loadingText : children}
      {iconRight}
    </button>
  );
}

type NextLinkProps = ComponentProps<typeof Link>;

export type ButtonLinkProps<T extends string = string> = Omit<NextLinkProps, "href" | "className"> &
  ButtonStyleProps & {
    /**
     * Internal route (validated when `typedRoutes` is enabled; cast computed strings `as Route`)
     * or an absolute "https://…" URL.
     */
    href: Route<T>;
    icon?: ReactNode;
    iconRight?: ReactNode;
    className?: string;
  };

/**
 * A `next/link` styled as a button. Use it for navigation (it keeps client-side routing, so the
 * venue player keeps playing); use <Button> for actions.
 */
export function ButtonLink<T extends string>({
  href,
  variant,
  size,
  fullWidth,
  icon,
  iconRight,
  className,
  children,
  ...props
}: ButtonLinkProps<T>) {
  return (
    <Link {...props} href={href} className={buttonClasses({ variant, size, fullWidth, className })}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}
