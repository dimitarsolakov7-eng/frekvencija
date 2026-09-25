/** Client-safe types of the /admin/settings screen (the page passes data and the Server Action as props). */
import type { ActionState } from "@/lib/actions/state";
import type { PlatformSettingsField } from "@/lib/validation/settings";

export type PlatformSettingsValues = Record<PlatformSettingsField, string>;
export type PlatformSettingsState = ActionState<PlatformSettingsValues>;
export type SavePlatformSettingsAction = (previous: PlatformSettingsState, formData: FormData) => Promise<PlatformSettingsState>;

/** The saved settings shown in the form. */
export interface PlatformSettingsFormData {
  contactEmail: string | null;
  contactPhone: string | null;
  privacyPolicy: string | null;
  termsOfService: string | null;
  defaultAnnouncementEveryNTracks: number;
  updatedAt: string | null;
  updatedByEmail: string | null;
  rowMissing: boolean;
}
