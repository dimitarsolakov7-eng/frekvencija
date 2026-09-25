import type { Metadata } from "next";
import { HelpScreen } from "@/components/player/HelpScreen";
import { requireBusinessUserPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Help" };

/** How the radio works, speaker tips, troubleshooting and the owner's contact details. */
export default async function HelpPage() {
  await requireBusinessUserPage("/help");
  return <HelpScreen />;
}
