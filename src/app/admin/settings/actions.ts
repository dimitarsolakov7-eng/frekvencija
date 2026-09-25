"use server";

import { revalidatePath } from "next/cache";
import type { PlatformSettingsState, PlatformSettingsValues } from "@/components/admin/settings/types";
import { lastFormString } from "@/components/admin/businesses/business-form";
import { describeDbError } from "@/lib/actions/state";
import { requireAdminAction } from "@/lib/auth/session";
import { toPlatformSettingsUpdate } from "@/lib/data/admin/settings";
import { formDataToObject, summarizeValidationError, toFieldErrors } from "@/lib/validation/forms";
import { PLATFORM_SETTINGS_FIELDS, platformSettingsSchema } from "@/lib/validation/settings";

function readValues(formData: FormData): PlatformSettingsValues {
  const values = {} as PlatformSettingsValues;
  for (const field of PLATFORM_SETTINGS_FIELDS) values[field] = lastFormString(formData, field);
  return values;
}

function failure(message: string, values: PlatformSettingsValues, fieldErrors: Record<string, string> = {}): PlatformSettingsState {
  return { ok: false, message, fieldErrors, values, nonce: Date.now() };
}

/**
 * /admin/settings: contact details, the default announcement frequency for new venues and the
 * privacy/terms text. Updates the platform_settings singleton (id = true) with the admin's own
 * client (RLS: admins only) and records who saved it.
 */
export async function savePlatformSettings(_previous: PlatformSettingsState, formData: FormData): Promise<PlatformSettingsState> {
  const { ctx, supabase } = await requireAdminAction();
  const values = readValues(formData);
  const parsed = platformSettingsSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return failure(summarizeValidationError(parsed.error), values, toFieldErrors(parsed.error));

  const { data, error } = await supabase
    .from("platform_settings")
    .update(toPlatformSettingsUpdate(parsed.data, ctx.userId))
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[admin/settings] save failed", error);
    return failure(describeDbError(error, "The settings could not be saved. Please try again."), values);
  }
  if (!data) {
    return failure(
      "The settings row is missing, so nothing was saved. Apply supabase/migrations/20260926000100_frekvencija.sql, which creates it.",
      values,
    );
  }

  revalidatePath("/admin/settings");
  revalidatePath("/privacy");
  revalidatePath("/terms");
  revalidatePath("/request-access");
  return { ok: true, message: "Settings saved.", fieldErrors: {}, nonce: Date.now() };
}
