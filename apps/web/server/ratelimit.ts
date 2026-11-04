import { getRedis } from './db.ts';

/**
 * Fixed-window attempt counter for forms (login, sign-up). Returns false when `limit` attempts
 * were already made in the window. Fails open without Redis.
 */
export async function allowAttempt(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    const key = `web:${bucket}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= limit;
  } catch {
    return true;
  }
}
