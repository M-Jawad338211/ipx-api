'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AccountError,
  canUseFeatures,
  createKey,
  issueVerificationCode,
  logIn,
  normalizeEmail,
  revokeKey,
  signUp,
  verifyEmailCode,
} from './accounts.ts';
import { isAdmin, reviewCorrection, submitCorrection } from './corrections.ts';
import { getDb } from './db.ts';
import { sendVerificationEmail } from './email.ts';
import { env } from './env.ts';
import { allowAttempt } from './ratelimit.ts';
import { endSession, requestIp, requireUser, startSession } from './session.ts';
import { verifyTurnstile } from './turnstile.ts';

export interface FormState {
  error?: string;
  field?: string;
  message?: string;
  /** Echo of the email so the form keeps it after an error. */
  email?: string;
}

export interface KeyFormState extends FormState {
  created?: { name: string; key: string };
}

function failure(error: unknown, email?: string): FormState {
  if (error instanceof AccountError) return { error: error.message, field: error.field, email };
  console.error(error);
  return { error: 'Something went wrong. Please try again.', email };
}

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = field(form, 'email');
  if (!(await allowAttempt(`signup:${await requestIp()}`, 10, 3600))) {
    return { error: 'Too many sign-ups from this network. Try again later.', email };
  }
  let user;
  try {
    user = await signUp(getDb(), { email, password: field(form, 'password') });
    await startSession(user.id);
  } catch (error) {
    return failure(error, email);
  }
  if (env.verificationRequired) {
    try {
      await issueVerificationCode(getDb(), user, sendVerificationEmail);
    } catch (error) {
      // The account exists; the dashboard offers to resend the code.
      console.error('could not send the verification email', error);
    }
  }
  redirect('/dashboard');
}

export async function logInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = field(form, 'email');
  const ip = await requestIp();
  if (!(await allowAttempt(`login:${ip}:${normalizeEmail(email)}`, 10, 600))) {
    return { error: 'Too many attempts. Wait a few minutes and try again.', email };
  }
  try {
    const user = await logIn(getDb(), { email, password: field(form, 'password') });
    await startSession(user.id);
  } catch (error) {
    return failure(error, email);
  }
  redirect('/dashboard');
}

export async function logOutAction(): Promise<void> {
  await endSession();
  redirect('/');
}

export async function verifyCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    await verifyEmailCode(getDb(), user.id, field(form, 'code'));
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/dashboard');
  redirect('/dashboard?verified=1');
}

export async function resendCodeAction(_prev: FormState, _form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!env.verificationRequired) return { message: 'Email confirmation is not required.' };
  try {
    await issueVerificationCode(getDb(), user, sendVerificationEmail);
  } catch (error) {
    return failure(error);
  }
  return { message: `We sent a new code to ${user.email}.` };
}

export async function createKeyAction(_prev: KeyFormState, form: FormData): Promise<KeyFormState> {
  const user = await requireUser();
  if (!canUseFeatures(user, env.verificationRequired)) {
    return { error: 'Confirm your email address before creating API keys.' };
  }
  try {
    const key = await createKey(getDb(), user.id, field(form, 'name'));
    revalidatePath('/dashboard');
    return { created: { name: key.name, key: key.key } };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeKeyAction(form: FormData): Promise<void> {
  const user = await requireUser();
  await revokeKey(getDb(), user.id, field(form, 'keyId'));
  revalidatePath('/dashboard');
}

export interface CorrectionFormState extends FormState {
  done?: boolean;
}

export async function submitCorrectionAction(
  _prev: CorrectionFormState,
  form: FormData,
): Promise<CorrectionFormState> {
  const ip = await requestIp();
  if (!(await allowAttempt(`correction:${ip}`, 5, 3600))) {
    return { error: 'Too many reports from this network. Try again in an hour.' };
  }
  if (!(await verifyTurnstile(field(form, 'cf-turnstile-response') || null, ip))) {
    return { error: 'Please complete the captcha and try again.' };
  }
  try {
    await submitCorrection(
      getDb(),
      {
        ip: field(form, 'ip'),
        countryCode: field(form, 'country'),
        region: field(form, 'region'),
        city: field(form, 'city'),
        email: field(form, 'email'),
        note: field(form, 'note'),
      },
      ip,
    );
  } catch (error) {
    return failure(error);
  }
  return { done: true };
}

export async function reviewCorrectionAction(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!isAdmin(user.email)) throw new Error('Not allowed');
  const decision = field(form, 'decision') === 'accepted' ? 'accepted' : 'rejected';
  await reviewCorrection(getDb(), {
    id: field(form, 'id'),
    reviewerId: user.id,
    decision,
    scope: field(form, 'scope') === 'network' ? 'network' : 'ip',
  });
  revalidatePath('/dashboard/corrections');
}
