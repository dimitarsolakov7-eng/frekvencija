import { AuthSplitShell } from "./_components/AuthSplitShell";

/**
 * Account-access pages (/login, /forgot-password, /reset-password): the screen 02 split layout.
 * Pages decide themselves whether they need (or must not have) a session.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <AuthSplitShell>{children}</AuthSplitShell>;
}
