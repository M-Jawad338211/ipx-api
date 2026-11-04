import { randomUUID } from 'node:crypto';
import { apiKeys, usageDaily, type Database } from '@ipx/db';
import { inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { StoreLogger } from '../data/store.ts';
import { USAGE_PENDING_KEY } from './limiter.ts';

const FLUSHING_PREFIX = 'usage:flushing:';

/**
 * Moves per-key daily usage counters from Redis to Postgres. The pending hash is renamed
 * atomically before reading, so several API processes can flush concurrently without losing or
 * double-counting requests. If Postgres fails, the counts are put back for the next run.
 */
export class UsageFlusher {
  readonly #redis: Redis;
  readonly #db: Database;
  readonly #log: StoreLogger;
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<number> | null = null;

  constructor(redis: Redis, db: Database, log: StoreLogger) {
    this.#redis = redis;
    this.#db = db;
    this.#log = log;
  }

  start(seconds: number): void {
    this.stop();
    this.#timer = setInterval(() => void this.flush(), seconds * 1000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Returns the number of requests written. Never throws. */
  flush(): Promise<number> {
    this.#running ??= this.#flush().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** Puts back snapshots left behind by a process that died mid-flush. */
  async recover(): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.#redis.scan(
          cursor,
          'MATCH',
          `${FLUSHING_PREFIX}*`,
          'COUNT',
          100,
        );
        cursor = next;
        for (const key of keys) await this.#restore(key);
      } while (cursor !== '0');
    } catch (error) {
      this.#log.warn({ err: error }, 'could not recover usage snapshots');
    }
  }

  async #flush(): Promise<number> {
    const snapshot = `${FLUSHING_PREFIX}${randomUUID()}`;
    try {
      await this.#redis.rename(USAGE_PENDING_KEY, snapshot);
    } catch (error) {
      if ((error as Error).message.includes('no such key')) return 0;
      this.#log.warn({ err: error }, 'usage flush: redis unavailable');
      return 0;
    }
    try {
      const entries = await this.#redis.hgetall(snapshot);
      const written = await this.#write(entries);
      await this.#redis.del(snapshot);
      return written;
    } catch (error) {
      this.#log.error({ err: error }, 'usage flush failed; counts kept for the next run');
      await this.#restore(snapshot);
      return 0;
    }
  }

  async #write(entries: Record<string, string>): Promise<number> {
    const rows: { keyId: string; date: string; count: number }[] = [];
    for (const [field, value] of Object.entries(entries)) {
      const [keyId, date] = field.split('|');
      const count = Number(value);
      if (keyId && date && count > 0) rows.push({ keyId, date, count });
    }
    if (rows.length === 0) return 0;

    // Keys deleted since the request are skipped (their usage rows are gone too).
    const keyIds = [...new Set(rows.map((r) => r.keyId))];
    const existing = await this.#db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(inArray(apiKeys.id, keyIds));
    const alive = new Set(existing.map((k) => k.id));
    const valid = rows.filter((r) => alive.has(r.keyId));
    if (valid.length === 0) return 0;

    await this.#db.transaction(async (tx) => {
      await tx
        .insert(usageDaily)
        .values(valid)
        .onConflictDoUpdate({
          target: [usageDaily.keyId, usageDaily.date],
          set: { count: sql`${usageDaily.count} + excluded.count` },
        });
      await tx
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(inArray(apiKeys.id, [...alive]));
    });
    return valid.reduce((sum, r) => sum + r.count, 0);
  }

  async #restore(snapshot: string): Promise<void> {
    try {
      const entries = await this.#redis.hgetall(snapshot);
      const pipeline = this.#redis.multi();
      for (const [field, value] of Object.entries(entries)) {
        pipeline.hincrby(USAGE_PENDING_KEY, field, Number(value));
      }
      pipeline.del(snapshot);
      await pipeline.exec();
    } catch (error) {
      this.#log.error({ err: error, snapshot }, 'could not restore usage snapshot');
    }
  }
}
