import { emailVerificationRequired } from '@ipx/db';

/** Server-side settings read from the environment (the repo-root .env in development). */
export const env = {
  get databaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    return url;
  },
  get redisUrl(): string | null {
    return process.env.REDIS_URL || null;
  },
  get resendApiKey(): string | null {
    return process.env.RESEND_API_KEY?.trim() || null;
  },
  /** Sender for verification emails. Resend's test sender only delivers to your own address. */
  get emailFrom(): string {
    return process.env.EMAIL_FROM || 'ipx <onboarding@resend.dev>';
  },
  /** Email confirmation is enforced only when emails can be sent (RESEND_API_KEY set). */
  get verificationRequired(): boolean {
    return emailVerificationRequired(process.env);
  },
  get paymentsEnabled(): boolean {
    return /^(1|true|yes|on)$/i.test(process.env.PAYMENTS_ENABLED ?? '');
  },
  get contactEmail(): string {
    return process.env.CONTACT_EMAIL || 'hello@example.com';
  },
  get secureCookies(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  get trustedProxy(): 'none' | 'cloudflare' {
    return process.env.TRUSTED_PROXY === 'cloudflare' ? 'cloudflare' : 'none';
  },
};

/** Public API base URL, used by the browser (landing-page demo, docs examples). */
export const publicApiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(
  /\/+$/,
  '',
);
