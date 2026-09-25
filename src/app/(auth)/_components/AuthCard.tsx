import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { FORM_LINK_CLASSES, FormHeading } from "@/components/public/FormHeading";

export interface AuthCardProps {
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  /** The page's single <h1>. */
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Secondary links or notes under a divider, e.g. "Back to log in". */
  footer?: ReactNode;
}

/** Card with the form-system heading, used inside the centered <AuthShell> (setup checklist). */
export function AuthCard({ eyebrow, title, description, children, footer }: AuthCardProps) {
  return (
    <Card>
      <div className="grid gap-6 px-5 py-7 sm:px-8 sm:py-8">
        <FormHeading eyebrow={eyebrow} title={title} description={description} />
        {children}
      </div>
      {footer && (
        <div className="grid gap-2 border-t border-border px-5 py-4 text-sm text-fg-muted sm:px-8">{footer}</div>
      )}
    </Card>
  );
}

/** Consistent inline text link for the auth pages. */
export const AUTH_LINK_CLASSES = FORM_LINK_CLASSES;
