"use client";

import { SettingsForm } from "@/components/admin/settings/SettingsForm";
import type { PlatformSettingsFormData, PlatformSettingsState, SavePlatformSettingsAction } from "@/components/admin/settings/types";

/** No-op save: answers like a successful save (the preview has no database). */
const previewSave: SavePlatformSettingsAction = async (): Promise<PlatformSettingsState> => {
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  return { ok: true, message: "Settings saved. (Preview only: nothing was saved.)", fieldErrors: {}, nonce: Date.now() };
};

/** The real settings form with fixture values and a no-op action. */
export function SettingsPreview({ settings }: { settings: PlatformSettingsFormData }) {
  return <SettingsForm settings={settings} action={previewSave} privacyHref="/privacy" termsHref="/terms" />;
}
