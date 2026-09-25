import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BusinessDetailPanel } from "@/components/admin/businesses/BusinessDetailPanel";
import { isBusinessDetailTab } from "@/components/admin/businesses/detail-tabs";
import { LoadErrorAlert } from "@/components/admin/businesses/LoadErrorAlert";
import { requireAdminPage } from "@/lib/auth/session";
import { loadAdminBusinessDetail, type AdminBusinessDetail } from "@/lib/data/admin/businesses";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation/fields";
import { inviteMember, removeBusinessLogo, removeMember, saveBusinessProfile, sendMemberAccess } from "../../actions";
import { authAdminPortOrNull, invitesUnavailableReason, SECRET_KEY_MISSING_REASON } from "../../_lib/availability";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/admin/businesses/[businessId]">): Promise<Metadata> {
  const { businessId } = await params;
  if (!idSchema.safeParse(businessId).success) return { title: "Business" };
  try {
    // RLS: only platform admins can read other businesses; everyone else gets the generic title.
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();
    return { title: data?.name ?? "Business" };
  } catch {
    return { title: "Business" };
  }
}

/** /admin/businesses/[businessId]: the venue's detail panel (Profile / Access / Announcements). */
export default async function BusinessDetailPage({ params, searchParams }: PageProps<"/admin/businesses/[businessId]">) {
  const { businessId } = await params;
  await requireAdminPage(`/admin/businesses/${businessId}`);
  if (!idSchema.safeParse(businessId).success) notFound();
  const { created, tab } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const auth = await authAdminPortOrNull();

  let detail: AdminBusinessDetail | null = null;
  try {
    detail = await loadAdminBusinessDetail(supabase, businessId, { auth, authUnavailableReason: SECRET_KEY_MISSING_REASON });
  } catch (error) {
    console.error("[admin/businesses] detail failed to load", error);
    return <LoadErrorAlert title="This business couldn’t be loaded" />;
  }
  if (!detail) notFound();

  return (
    <BusinessDetailPanel
      key={businessId}
      detail={detail}
      actions={{ saveBusinessProfile, removeBusinessLogo, inviteMember, sendMemberAccess, removeMember }}
      invitesUnavailableReason={invitesUnavailableReason()}
      genresHref="/admin/genres"
      initialTab={isBusinessDetailTab(tab) ? tab : "profile"}
      justCreated={created === "1"}
    />
  );
}
