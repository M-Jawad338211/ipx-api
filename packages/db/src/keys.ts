import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'ipx_';
const KEY_RE = /^ipx_[A-Za-z0-9_-]{32}$/;
/** Characters of the key shown in the dashboard. */
export const VISIBLE_PREFIX_LENGTH = 12;

export interface NewApiKey {
  /** The full key, shown to the user exactly once. */
  key: string;
  prefix: string;
  hash: string;
}

/** `ipx_` + 32 base64url characters (192 bits of randomness). */
export function generateApiKey(): NewApiKey {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, VISIBLE_PREFIX_LENGTH), hash: hashApiKey(key) };
}

/** Keys are high-entropy, so a plain sha256 is enough to store them safely. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function looksLikeApiKey(value: string): boolean {
  return KEY_RE.test(value);
}

/**
 * Email verification is only enforced when emails can actually be sent, i.e. when
 * RESEND_API_KEY is configured. Without it, accounts work right after sign-up.
 */
export function emailVerificationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}
