'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  logInAction,
  resendCodeAction,
  signUpAction,
  verifyCodeAction,
  type FormState,
} from '@/server/actions';
import { Alert, Button, FieldError, Input, Label } from './ui';

export function SignUpForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && state.field === 'form' && <Alert tone="error" title={state.error} />}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
        />
        <FieldError>{state.field === 'email' && state.error}</FieldError>
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FieldError>{state.field === 'password' ? state.error : null}</FieldError>
        <p className="mt-1.5 text-xs text-fd-muted-foreground">At least 8 characters.</p>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-fd-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-fd-foreground underline underline-offset-4">
          Log in
        </Link>
      </p>
    </form>
  );
}

export function LogInForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(logInAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="error" title={state.error} />}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Logging in…' : 'Log in'}
      </Button>
      <p className="text-center text-sm text-fd-muted-foreground">
        New here?{' '}
        <Link
          href="/signup"
          className="font-medium text-fd-foreground underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function VerifyForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyCodeAction, {});
  const [resendState, resend, resending] = useActionState<FormState, FormData>(
    resendCodeAction,
    {},
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-fd-muted-foreground">
        Enter the 6-digit code we emailed to{' '}
        <span className="font-medium text-fd-foreground">{email}</span>. Codes expire after 10
        minutes. No email? Request a new code below.
      </p>
      <form action={action} className="space-y-4">
        <div>
          <Label htmlFor="code">Confirmation code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            placeholder="123456"
            required
            className="font-mono text-lg tracking-[0.4em]"
          />
          <FieldError>{state.error}</FieldError>
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Checking…' : 'Confirm email'}
        </Button>
      </form>
      <form action={resend} className="text-center">
        <Button type="submit" variant="ghost" disabled={resending}>
          {resending ? 'Sending…' : 'Send a new code'}
        </Button>
        {resendState.message && (
          <p className="mt-1 text-sm text-emerald-600">{resendState.message}</p>
        )}
        <FieldError>{resendState.error}</FieldError>
      </form>
    </div>
  );
}
