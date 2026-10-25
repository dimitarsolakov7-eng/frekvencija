import type { SiteCopy } from "@/content/site/types";
import type { AppRole } from "@/types/database";

export interface AccountLink {
  href: "/login" | "/radio" | "/admin";
  label: string;
}

/** "Log in" for visitors; signed-in users get a direct way back into their own area instead. */
export function accountLinkFor(role: AppRole | null, nav: Pick<SiteCopy["nav"], "logIn" | "openRadio" | "adminWorkspace">): AccountLink {
  if (role === "platform_admin") return { href: "/admin", label: nav.adminWorkspace };
  if (role === "business_user") return { href: "/radio", label: nav.openRadio };
  return { href: "/login", label: nav.logIn };
}
