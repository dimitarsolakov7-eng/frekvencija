import type { Metadata } from "next";
import { AccountView } from "@/components/player/AccountView";
import { requireBusinessUserPage } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAccountDetails } from "./_lib/account-details";
import { sendAccountPasswordReset } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account" };

/**
 * Venue details (read-only), password reset/change, sign out and this device's playback settings.
 * The layout's persistent player keeps the music going while this page is open.
 */
export default async function AccountPage() {
  const ctx = await requireBusinessUserPage("/account");
  // The layout shows the "no venue" screen instead of this page; this keeps the types honest.
  const result = ctx.business
    ? await loadAccountDetails(await createSupabaseServerClient(), ctx.business, ctx.email)
    : {
        details: {
          businessName: "No venue linked",
          stationName: "—",
          businessType: "—",
          contactEmail: null,
          announcementLanguage: "—",
          signedInEmail: ctx.email,
        },
        partial: true,
      };

  return (
    <AccountView
      details={result.details}
      partial={result.partial}
      resetAction={sendAccountPasswordReset}
      changePasswordHref="/reset-password"
    />
  );
}
