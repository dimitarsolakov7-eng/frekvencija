"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { Alert, Field, FormMessage, Input, SubmitButton } from "@/components/ui";
import { requestPasswordReset, type ResetRequestState } from "./actions";

const INITIAL_STATE: ResetRequestState = { ok: false, message: null, fieldErrors: {} };

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-5">
      {/* The neutral result lives in a polite live region that is always rendered. */}
      <FormMessage message={state.ok ? state.message : null} tone="success" />
      {!state.ok && state.message && <Alert key={state.nonce} tone="danger" description={state.message} />}

      <Field label="Email address" hint="The address you log in with." error={state.fieldErrors.email}>
        <Input
          name="email"
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          placeholder="you@yourbusiness.com"
          defaultValue={state.values?.email}
        />
      </Field>

      <SubmitButton size="lg" fullWidth pendingLabel="Sending…" icon={<Mail aria-hidden="true" />} className="mt-2">
        {state.ok ? "Send the link again" : "Send reset link"}
      </SubmitButton>
    </form>
  );
}
