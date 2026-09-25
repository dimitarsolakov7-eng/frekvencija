"use client";

import { useActionState } from "react";
import type { Route } from "next";
import { KeyRound, Mail } from "lucide-react";
import { PageHeading } from "@/components/shell/PageHeading";
import {
  Alert,
  Avatar,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FormMessage,
  Input,
  SubmitButton,
} from "@/components/ui";
import { PLATFORM_NAME } from "@/config/platform";
import type { ActionState } from "@/lib/actions/state";
import { useFlagPreference } from "./hooks";
import { shortcutsPreference } from "./local-preference";
import { PlaybackSettings } from "./PlaybackSettings";
import { usePlayer } from "./PlayerProvider";
import { venueInitial } from "./player-view";
import { SignOutButton } from "./SignOutButton";

/** Read-only venue details shown on /account (labels already resolved on the server). */
export interface VenueAccountDetails {
  businessName: string;
  stationName: string;
  /** "Café", "Hotel"… */
  businessType: string;
  contactEmail: string | null;
  /** "English (en)"… */
  announcementLanguage: string;
  signedInEmail: string;
}

export type PasswordResetAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

export interface AccountViewProps {
  details: VenueAccountDetails;
  /** Some details could not be loaded; the ones shown come from the session. */
  partial?: boolean;
  /** Emails a reset link to the signed-in address (Server Action in the app). */
  resetAction: PasswordResetAction;
  changePasswordHref: Route;
}

const INITIAL_RESET_STATE: ActionState = { ok: false, message: null, fieldErrors: {} };

function ReadOnlyField({ label, value, placeholder }: { label: string; value: string | null; placeholder?: string }) {
  return (
    <Field label={label}>
      <Input readOnly value={value ?? ""} placeholder={placeholder} />
    </Field>
  );
}

/**
 * /account (03 shell, 06 form styling): the venue's details (read-only; the owner manages them),
 * password reset and change, sign out, and this device's playback settings. The persistent player
 * keeps playing throughout.
 */
export function AccountView({ details, partial = false, resetAction, changePasswordHref }: AccountViewProps) {
  const { bootstrap, wakeLock } = usePlayer();
  const [shortcutsEnabled, setShortcutsEnabled] = useFlagPreference(shortcutsPreference);
  const [resetState, sendReset] = useActionState(resetAction, INITIAL_RESET_STATE);

  return (
    <div className="grid gap-6">
      <PageHeading
        eyebrow="Your venue"
        title="Account"
        description="Your venue details, sign-in and playback settings."
        className="pb-0 lg:pb-2"
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Venue details</CardTitle>
              <CardDescription>Only your {PLATFORM_NAME} administrator can change these details.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="flex min-w-0 items-center gap-4">
                <Avatar
                  name={details.businessName}
                  initials={venueInitial(details.businessName)}
                  imageUrl={bootstrap.business.logoUrl}
                  size="xl"
                  shape="rounded"
                  decorative
                />
                <div className="grid min-w-0">
                  <p className="truncate text-lg font-semibold text-fg">{details.businessName}</p>
                  <p className="truncate text-sm text-fg-muted">{details.stationName}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ReadOnlyField label="Business name" value={details.businessName} />
                <ReadOnlyField label="Station name" value={details.stationName} />
                <ReadOnlyField label="Business type" value={details.businessType} />
                <ReadOnlyField label="Announcement language" value={details.announcementLanguage} />
                <div className="sm:col-span-2">
                  <ReadOnlyField label="Contact email" value={details.contactEmail} placeholder="Not set" />
                </div>
              </div>
              {partial && (
                <Alert
                  tone="warning"
                  description="Some venue details couldn't be loaded right now. Reload the page to try again; the radio is not affected."
                />
              )}
            </CardContent>
          </Card>

          <PlaybackSettings
            shortcutsEnabled={shortcutsEnabled}
            onShortcutsChange={setShortcutsEnabled}
            wakeLock={wakeLock}
          />
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Your password is never shown here. Reset it by email or choose a new one now.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <ReadOnlyField label="Signed in as" value={details.signedInEmail} />
              <form action={sendReset} className="grid gap-3">
                <SubmitButton variant="secondary" icon={<Mail aria-hidden="true" />} pendingLabel="Sending…">
                  Send password reset email
                </SubmitButton>
                <FormMessage state={resetState} />
              </form>
              <div className="grid gap-2 border-t border-border pt-5">
                <ButtonLink href={changePasswordHref} variant="outline" icon={<KeyRound aria-hidden="true" />}>
                  Change password now
                </ButtonLink>
                <p className="text-sm text-fg-muted text-pretty">
                  This opens a separate page, so the radio stops while you change your password.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sign out</CardTitle>
              <CardDescription>Stops the radio on this device and signs you out here. Other devices stay signed in.</CardDescription>
            </CardHeader>
            <CardContent>
              <SignOutButton variant="secondary" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
