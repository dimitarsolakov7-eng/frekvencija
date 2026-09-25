import { AuthSplitShell } from "@/app/(auth)/_components/AuthSplitShell";

/** /auth/* pages (email-link confirmation) share the screen 02 form system. Route handlers ignore layouts. */
export default function AuthRoutesLayout({ children }: LayoutProps<"/auth">) {
  return <AuthSplitShell>{children}</AuthSplitShell>;
}
