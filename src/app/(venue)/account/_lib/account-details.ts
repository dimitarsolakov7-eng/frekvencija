import "server-only";
import type { VenueAccountDetails } from "@/components/player/AccountView";
import { BUSINESS_TYPE_OPTIONS } from "@/components/public/request-access-options";
import type { BusinessType } from "@/lib/api/contracts";
import type { SessionBusiness } from "@/lib/auth/access";
import { languageDisplayName } from "@/lib/tts/models";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

export interface AccountDetailsResult {
  details: VenueAccountDetails;
  /** The venue row could not be read; name and station come from the session, the rest is unknown. */
  partial: boolean;
}

/** "Café", "Hotel"…; unknown values read as "Other" (like the player bootstrap). */
export function businessTypeLabel(type: string | null | undefined): string {
  const option = BUSINESS_TYPE_OPTIONS.find((candidate) => candidate.value === (type as BusinessType));
  return option?.label ?? "Other";
}

/** "English (en)", or the raw code when the runtime has no name for it. */
export function announcementLanguageLabel(code: string | null | undefined): string {
  const value = code?.trim();
  if (!value) return "Not set";
  const name = languageDisplayName(value);
  return name && name !== value ? `${name} (${value})` : value;
}

/**
 * The venue's own details for /account, read with the signed-in user's client: RLS lets a member
 * read only their own venue, and the id comes from the session, never from the request. A failed
 * read degrades to the session's name/station instead of failing the page.
 */
export async function loadAccountDetails(
  supabase: TypedSupabaseClient,
  business: SessionBusiness,
  signedInEmail: string,
): Promise<AccountDetailsResult> {
  const fallback: VenueAccountDetails = {
    businessName: business.name,
    stationName: business.stationName,
    businessType: "—",
    contactEmail: null,
    announcementLanguage: "—",
    signedInEmail,
  };
  try {
    const { data, error } = await supabase
      .from("businesses")
      .select("name, station_name, business_type, contact_email, announcement_language")
      .eq("id", business.id)
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn("[venue] could not read the account details", { code: error.code });
      return { details: fallback, partial: true };
    }
    return {
      details: {
        businessName: data.name,
        stationName: data.station_name,
        businessType: businessTypeLabel(data.business_type),
        contactEmail: data.contact_email?.trim() || null,
        announcementLanguage: announcementLanguageLabel(data.announcement_language),
        signedInEmail,
      },
      partial: false,
    };
  } catch (error) {
    console.warn("[venue] could not read the account details", error);
    return { details: fallback, partial: true };
  }
}
