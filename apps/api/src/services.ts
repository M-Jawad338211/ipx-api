import { createDb, type Database } from '@ipx/db';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Config } from './config.ts';
import type { StoreLogger } from './data/store.ts';
import type { AccessServices } from './limits/access.ts';
import type { Metrics } from './metrics.ts';
import { KeyResolver } from './limits/keys.ts';
import { Limiter } from './limits/limiter.ts';
import { UsageFlusher } from './limits/usage.ts';

export type ServiceState = 'ok' | 'error' | 'disabled';

/** Connections to Redis and Postgres. Both are optional so the lookup core runs without them. */
export class Services implements AccessServices {
  readonly config: Config;
  readonly redis: Redis | null;
  readonly db: Database | null;
  readonly limiter: Limiter | null;
  readonly keys: KeyResolver | null;
  readonly usage: UsageFlusher | null;
  metrics: Metrics | null = null;
  readonly #closeDb: (() => Promise<void>) | null;
  readonly #log: StoreLogger;

  constructor(config: Config, log: StoreLogger) {
    this.config = config;
    this.#log = log;

    let redis: Redis | null = null;
    if (config.redisUrl) {
      redis = new Redis(config.redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false, // fail fast (and open) instead of queueing while Redis is down
        maxRetriesPerRequest: 1,
      });
      let lastError = 0;
      redis.on('error', (error: Error) => {
        if (Date.now() - lastError > 60_000) log.warn({ err: error }, 'redis connection error');
        lastError = Date.now();
      });
    }
    this.redis = redis;
    this.limiter = redis ? new Limiter(redis) : null;

    if (config.databaseUrl) {
      const { db, close } = createDb(config.databaseUrl);
      this.db = db;
      this.#closeDb = close;
      this.keys = new KeyResolver(db, config.keyCacheSeconds);
    } else {
      this.db = null;
      this.#closeDb = null;
      this.keys = null;
    }
    this.usage = redis && this.db ? new UsageFlusher(redis, this.db, log) : null;
  }

  async connect(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.connect();
      } catch (error) {
        this.#log.error({ err: error }, 'redis not reachable at startup: limits are not enforced');
      }
    }
    if (!this.redis) this.#log.warn({}, 'REDIS_URL not set: rate limits and quotas are disabled');
    if (!this.db) this.#log.warn({}, 'DATABASE_URL not set: requests with an API key get 503');
    await this.usage?.recover();
  }

  startBackgroundJobs(): void {
    this.usage?.start(this.config.usageFlushSeconds);
  }

  async close(): Promise<void> {
    this.usage?.stop();
    await this.usage?.flush();
    if (this.redis) this.redis.disconnect();
    await this.#closeDb?.();
  }

  async status(): Promise<{ redis: ServiceState; database: ServiceState }> {
    const withTimeout = <T>(promise: Promise<T>) =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
      ]);
    const redis: ServiceState = !this.redis
      ? 'disabled'
      : await withTimeout(this.redis.ping()).then(
          () => 'ok' as const,
          () => 'error' as const,
        );
    const database: ServiceState = !this.db
      ? 'disabled'
      : await withTimeout(this.db.execute(sql`select 1`)).then(
          () => 'ok' as const,
          () => 'error' as const,
        );
    return { redis, database };
  }
}
