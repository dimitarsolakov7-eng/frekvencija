"use client";

import { useActionState } from "react";
import { KeyRound, LogIn } from "lucide-react";
import { Alert, ButtonLink, Field, PasswordInput, SubmitButton } from "@/components/ui";
import { PASSWORD_MIN_LENGTH } from "../_lib/password";
import { resetPassword, type ResetPasswordState } from "./actions";

const INITIAL_STATE: ResetPasswordState = { ok: false, message: null, fieldErrors: {} };

export interface ResetPasswordFormProps {
  /** The signed-in account, offered to password managers as the username ("" when unknown). */
  email: string;
}

export function ResetPasswordForm({ email }: ResetPasswordFormProps) {
  const [state, formAction] = useActionState(resetPassword, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-5">
      {!state.ok && state.message && (
        <Alert key={state.nonce} tone="danger" description={state.message}>
          {state.sessionEnded && (
            // Expired-link recovery: a fresh reset link, or signing in with the current password.
            <div className="mt-2 flex flex-wrap gap-2">
              <ButtonLink href="/forgot-password" size="sm" icon={<KeyRound aria-hidden="true" />}>
                Request a new link
              </ButtonLink>
              <ButtonLink
                href="/login?next=%2Freset-password"
                size="sm"
                variant="secondary"
                icon={<LogIn aria-hidden="true" />}
              >
                Log in
              </ButtonLink>
            </div>
          )}
        </Alert>
      )}

      {/* Lets password managers store the new password under the right account (not submitted). */}
      {email && <input type="email" autoComplete="username" value={email} readOnly hidden />}

      <Field
        label="New password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words make a password that is strong and easy to remember.`}
        error={state.fieldErrors.password}
      >
        <PasswordInput name="password" required autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
      </Field>

      <Field label="Confirm new password" error={state.fieldErrors.confirmPassword}>
        <PasswordInput name="confirmPassword" required autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
      </Field>

      <SubmitButton size="lg" fullWidth pendingLabel="Saving…" className="mt-2">
        Save password
      </SubmitButton>
    </form>
  );
}
