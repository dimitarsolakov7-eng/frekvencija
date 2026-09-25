import type { Metadata } from "next";
import { RadioScreen } from "@/components/player/RadioScreen";
import { getSessionContext, requireBusinessUserPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getSessionContext().catch(() => null);
  return { title: ctx?.business?.stationName ?? "Your radio" };
}

/**
 * The venue's radio. The session is checked here too (layouts do not re-run on client navigation);
 * the layout has already handled "no venue" and "inactive venue", and the player itself lives in the
 * layout's PlayerProvider, so this page only renders the screen over it.
 */
export default async function RadioPage() {
  await requireBusinessUserPage("/radio");
  return <RadioScreen />;
}
