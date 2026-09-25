import { LogOut } from "lucide-react";
import { Button, IconButton } from "@/components/ui";

export interface SignOutFormProps {
  /** Icon-only button for the compact mobile header. */
  compact?: boolean;
  className?: string;
}

/**
 * Sign-out as a plain HTML form POST to /auth/signout (signs out this device only, then 303 to
 * /login). Works without JavaScript and always does a full page load, which resets all client state.
 */
export function SignOutForm({ compact = false, className }: SignOutFormProps) {
  return (
    <form action="/auth/signout" method="post" className={className}>
      {compact ? (
        <IconButton type="submit" variant="ghost" aria-label="Sign out" icon={<LogOut />} />
      ) : (
        <Button type="submit" variant="ghost" fullWidth icon={<LogOut aria-hidden="true" />} className="justify-start!">
          Sign out
        </Button>
      )}
    </form>
  );
}
