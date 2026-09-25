import type { ComponentPropsWithRef, ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type AlertTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { box: string; iconColor: string; icon: LucideIcon }> = {
  neutral: { box: "border-border bg-surface-2", iconColor: "text-fg-muted", icon: Info },
  info: { box: "border-info/30 bg-info/10", iconColor: "text-info", icon: Info },
  success: { box: "border-success/30 bg-success/10", iconColor: "text-success", icon: CircleCheck },
  warning: { box: "border-warning/30 bg-warning/10", iconColor: "text-warning", icon: TriangleAlert },
  danger: { box: "border-danger/30 bg-danger/10", iconColor: "text-danger", icon: CircleAlert },
};

export interface AlertProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  tone?: AlertTone;
  title?: ReactNode;
  description?: ReactNode;
  /** A button or link, e.g. "Retry"; wraps under the text on narrow screens. */
  action?: ReactNode;
  /** Replace the tone's default icon (pass `null` for none). */
  icon?: ReactNode;
}

/**
 * Inline message box. `danger` alerts use role="alert" (announced immediately when they appear);
 * the other tones use role="status". Override with the `role` prop when needed.
 */
export function Alert({
  tone = "neutral",
  title,
  description,
  action,
  icon,
  role,
  className,
  children,
  ...props
}: AlertProps) {
  const { box, iconColor, icon: ToneIcon } = TONES[tone];
  return (
    <div
      {...props}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn("flex flex-wrap items-start gap-3 rounded-card border p-4 text-sm", box, className)}
    >
      {icon !== null && (
        <span aria-hidden="true" className={cn("mt-0.5 shrink-0 [&_svg]:size-5", iconColor)}>
          {icon ?? <ToneIcon />}
        </span>
      )}
      <div className="grid min-w-0 flex-1 basis-56 gap-1">
        {title && <p className="font-medium text-fg">{title}</p>}
        {description && <div className="text-fg-muted text-pretty">{description}</div>}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 self-center">{action}</div>}
    </div>
  );
}
