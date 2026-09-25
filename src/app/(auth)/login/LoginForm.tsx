"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Alert, Field, Input, PasswordInput, SubmitButton } from "@/components/ui";
import { signIn, type SignInState } from "./actions";

const INITIAL_STATE: SignInState = { ok: false, message: null, fieldErrors: {} };

export interface LoginFormProps {
  /** Already-sanitised path to return to after signing in ("" for the role's home page). */
  next: string;
}

export function LoginForm({ next }: LoginFormProps) {
  const [state, formAction] = useActionState(signIn, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-5">
      {/* Keyed by the result nonce so a repeated error is inserted (and announced) again. */}
      {!state.ok && state.message && <Alert key={state.nonce} tone="danger" description={state.message} />}

      {next && <input type="hidden" name="next" value={next} />}

      <Field label="Email address" error={state.fieldErrors.email}>
        <Input
          name="email"
          type="email"
          required
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          placeholder="you@yourbusiness.com"
          defaultValue={state.values?.email}
        />
      </Field>

      <div className="grid gap-2">
        <Field label="Password" error={state.fieldErrors.password}>
          <PasswordInput name="password" required autoComplete="current-password" maxLength={1024} />
        </Field>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="inline-flex min-h-6 items-center rounded-sm text-sm text-fg-muted underline underline-offset-4 decoration-fg-muted/50 transition-colors hover:text-fg"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      <SubmitButton size="lg" fullWidth pendingLabel="Logging in…" className="mt-2">
        Log in
      </SubmitButton>
    </form>
  );
}
