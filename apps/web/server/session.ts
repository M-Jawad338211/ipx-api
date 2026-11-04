import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSession, deleteSession, getSessionUser, type User } from './accounts.ts';
import { getDb } from './db.ts';
import { env } from './env.ts';

const COOKIE = 'ipx_session';

export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(getDb(), userId);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.secureCookies,
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Cached per request. */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(getDb(), token);
});

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

/** Client IP for form rate limits (proxy headers only behind Cloudflare). */
export async function requestIp(): Promise<string> {
  const h = await headers();
  if (env.trustedProxy === 'cloudflare') {
    const cf = h.get('cf-connecting-ip');
    if (cf) return cf;
  }
  return h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}
