import { createDb, type Database } from '@ipx/db';
import { Redis } from 'ioredis';
import { env } from './env.ts';

// One pool per server process, kept across hot reloads in development.
const globalCache = globalThis as unknown as {
  __ipxDb?: ReturnType<typeof createDb>;
  __ipxRedis?: Redis | null;
};

export function getDb(): Database {
  globalCache.__ipxDb ??= createDb(env.databaseUrl, { max: 5 });
  return globalCache.__ipxDb.db;
}

/** Redis for form rate limits; null when REDIS_URL is not configured. */
export function getRedis(): Redis | null {
  if (globalCache.__ipxRedis === undefined) {
    const url = env.redisUrl;
    globalCache.__ipxRedis = url
      ? new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
      : null;
    globalCache.__ipxRedis?.on('error', () => {
      // connection errors are retried by ioredis; rate limits fail open meanwhile
    });
  }
  return globalCache.__ipxRedis;
}
