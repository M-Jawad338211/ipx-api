/**
 * Account logic (sign-up, login, sessions, email codes, API keys, usage). Pure functions over a
 * Database handle so they can be tested without Next.js; server actions wrap them.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  apiKeys,
  emailVerificationCodes,
  generateApiKey,
  planById,
  sessions,
  subscriptions,
  usageDaily,
  users,
  type Database,
  type PlanDefinition,
} from '@ipx/db';
import { and, asc, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.ts';

export class AccountError extends Error {
  readonly field: 'email' | 'password' | 'code' | 'name' | 'form';
  constructor(message: string, field: AccountError['field'] = 'form') {
    super(message);
    this.name = 'AccountError';
    this.field = field;
  }
}

export type User = typeof users.$inferSelect;

export const SESSION_DAYS = 30;
export const CODE_TTL_MINUTES = 10;
export const CODE_RESEND_SECONDS = 60;
export const CODE_MAX_ATTEMPTS = 5;
export const MAX_ACTIVE_KEYS = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// --- sign-up and login -------------------------------------------------------------------------

export async function signUp(
  db: Database,
  input: { email: string; password: string },
): Promise<User> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new AccountError('Enter a valid email address', 'email');
  }
  if (input.password.length < 8) {
    throw new AccountError('Use at least 8 characters', 'password');
  }
  if (input.password.length > 200) {
    throw new AccountError('Use at most 200 characters', 'password');
  }
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (!user) throw new AccountError('An account with this email already exists', 'email');
  return user;
}

export async function logIn(
  db: Database,
  input: { email: string; password: string },
): Promise<User> {
  const email = normalizeEmail(input.email);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // Always run one hash so unknown emails and wrong passwords take the same time.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AccountError('Wrong email or password', 'form');
  return user;
}

// --- sessions ----------------------------------------------------------------------------------

/** Creates a session and returns the token for the cookie (only its hash is stored). */
export async function createSession(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(
  db: Database,
  token: string,
  now = new Date(),
): Promise<User | null> {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  return row?.user ?? null;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

// --- email verification (OTP) ------------------------------------------------------------------

function codeHash(userId: string, code: string): string {
  return sha256(`${userId}:${code}`);
}

export type SendCode = (to: string, code: string) => Promise<void>;

/**
 * Creates a fresh 6-digit code (replacing any previous one) and sends it. Codes expire after
 * 10 minutes; a new one can be requested once a minute.
 */
export async function issueVerificationCode(
  db: Database,
  user: Pick<User, 'id' | 'email' | 'emailVerifiedAt'>,
  send: SendCode,
  now = new Date(),
): Promise<void> {
  if (user.emailVerifiedAt) throw new AccountError('Your email is already confirmed');
  const [existing] = await db
    .select({ sentAt: emailVerificationCodes.sentAt })
    .from(emailVerificationCodes)
    .where(eq(emailVerificationCodes.userId, user.id));
  if (existing) {
    const wait = Math.ceil(
      (existing.sentAt.getTime() + CODE_RESEND_SECONDS * 1000 - now.getTime()) / 1000,
    );
    if (wait > 0)
      throw new AccountError(`Please wait ${wait} seconds before requesting a new code`);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const values = {
    userId: user.id,
    codeHash: codeHash(user.id, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
    attempts: 0,
    sentAt: now,
  };
  await db
    .insert(emailVerificationCodes)
    .values(values)
    .onConflictDoUpdate({ target: emailVerificationCodes.userId, set: values });
  try {
    await send(user.email, code);
  } catch (error) {
    // Nothing was delivered: drop the code so the user can retry at once.
    await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, user.id));
    console.error('verification email failed', error);
    throw new AccountError('We could not send the email right now. Please try again in a minute.');
  }
}

export async function verifyEmailCode(
  db: Database,
  userId: string,
  input: string,
  now = new Date(),
): Promise<void> {
  const code = input.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code))
    throw new AccountError('Enter the 6-digit code from the email', 'code');
  const [row] = await db
    .select()
    .from(emailVerificationCodes)
    .where(eq(emailVerificationCodes.userId, userId));
  if (!row) throw new AccountError('No code is pending. Request a new one.', 'code');
  if (row.expiresAt <= now)
    throw new AccountError('This code has expired. Request a new one.', 'code');
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    throw new AccountError('Too many wrong attempts. Request a new code.', 'code');
  }
  const expected = Buffer.from(row.codeHash, 'hex');
  const actual = Buffer.from(codeHash(userId, code), 'hex');
  if (!timingSafeEqual(expected, actual)) {
    await db
      .update(emailVerificationCodes)
      .set({ attempts: sql`${emailVerificationCodes.attempts} + 1` })
      .where(eq(emailVerificationCodes.userId, userId));
    const left = CODE_MAX_ATTEMPTS - row.attempts - 1;
    throw new AccountError(
      left > 0
        ? `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'Wrong code. Request a new one.',
      'code',
    );
  }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, userId));
    await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId));
  });
}

/** Whether the user may use features gated behind a confirmed email. */
export function canUseFeatures(
  user: Pick<User, 'emailVerifiedAt'>,
  verificationRequired: boolean,
): boolean {
  return !verificationRequired || user.emailVerifiedAt !== null;
}

// --- API keys ----------------------------------------------------------------------------------

export async function listKeys(db: Database, userId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
}

/** Creates a key and returns the full secret once. */
export async function createKey(db: Database, userId: string, rawName: string) {
  const name = rawName.trim() || 'Default';
  if (name.length > 60) throw new AccountError('Use at most 60 characters', 'name');
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
  if ((count?.n ?? 0) >= MAX_ACTIVE_KEYS) {
    throw new AccountError(`You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`);
  }
  const key = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, name, prefix: key.prefix, keyHash: key.hash })
    .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix });
  return { ...row!, key: key.key };
}

export async function revokeKey(db: Database, userId: string, keyId: string): Promise<void> {
  const result = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (result.length === 0) throw new AccountError('Key not found');
}

// --- plan and usage ----------------------------------------------------------------------------

export interface CurrentPlan {
  plan: PlanDefinition;
  status: string | null;
  currentPeriodEnd: Date | null;
}

export async function currentPlan(db: Database, userId: string): Promise<CurrentPlan> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const active = sub && ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status);
  return {
    plan: planById(active ? sub.planId : 'free'),
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
  };
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Lookups per UTC day for the last `days` days (oldest first, zero-filled). */
export async function dailyUsage(db: Database, userId: string, days = 30, now = new Date()) {
  const start = new Date(now.getTime() - (days - 1) * 86_400_000);
  const rows = await db
    .select({ date: usageDaily.date, count: sql<number>`sum(${usageDaily.count})::int` })
    .from(usageDaily)
    .innerJoin(apiKeys, eq(apiKeys.id, usageDaily.keyId))
    .where(and(eq(apiKeys.userId, userId), gte(usageDaily.date, utcDay(start))))
    .groupBy(usageDaily.date)
    .orderBy(asc(usageDaily.date));
  const byDay = new Map(rows.map((r) => [r.date, r.count]));
  return Array.from({ length: days }, (_, i) => {
    const date = utcDay(new Date(start.getTime() + i * 86_400_000));
    return { date, count: byDay.get(date) ?? 0 };
  });
}

/** Lookups this calendar month (UTC) across all keys of the account. */
export async function monthUsage(db: Database, userId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageDaily.count}), 0)::int` })
    .from(usageDaily)
    .innerJoin(apiKeys, eq(apiKeys.id, usageDaily.keyId))
    .where(and(eq(apiKeys.userId, userId), gte(usageDaily.date, `${utcDay(now).slice(0, 8)}01`)));
  return row?.total ?? 0;
}
