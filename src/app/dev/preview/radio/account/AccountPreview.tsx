"use client";

import { AccountView, type PasswordResetAction } from "@/components/player/AccountView";
import { PREVIEW_EMAIL } from "../fixtures";

/** Stand-in for the reset Server Action: nothing is sent from a preview. */
const previewReset: PasswordResetAction = async () => ({
  ok: true,
  message: `Preview only: no email was sent. In the app a reset link goes to ${PREVIEW_EMAIL}.`,
  fieldErrors: {},
  nonce: Date.now(),
});

export function AccountPreview({ partial = false }: { partial?: boolean }) {
  return (
    <AccountView
      details={{
        businessName: "EmeraldBar",
        stationName: "EmeraldBar Radio",
        businessType: "Bar",
        contactEmail: PREVIEW_EMAIL,
        announcementLanguage: "English (en)",
        signedInEmail: PREVIEW_EMAIL,
      }}
      partial={partial}
      resetAction={previewReset}
      changePasswordHref="/dev/preview/radio/account"
    />
  );
}
