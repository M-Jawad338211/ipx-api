import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  apiKeys,
  hashApiKey,
  planById,
  subscriptions,
  usageDaily,
  users,
  type Database,
} from '@ipx/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Lru } from '../lru.ts';

export interface KeyInfo {
  keyId: string;
  userId: string;
  planId: string;
  monthlyQuota: number;
  emailVerified: boolean;
  revoked: boolean;
  /** Lookups of the whole account this month already stored in Postgres (seeds Redis). */
  storedMonthUsage: number;
}

interface CacheEntry {
  info: KeyInfo | null;
  expires: number;
}

/**
 * Resolves API keys to account, plan and status. Results (including unknown keys) are cached in
 * memory for `ttlSeconds`, so Postgres is only queried on a cache miss.
 */
export class KeyResolver {
  readonly #db: Database;
  readonly #ttlMs: number;
  readonly #cache = new Lru<string, CacheEntry>(50_000);
  readonly #inflight = new Map<string, Promise<KeyInfo | null>>();

  constructor(db: Database, ttlSeconds: number) {
    this.#db = db;
    this.#ttlMs = ttlSeconds * 1000;
  }

  async resolve(key: string, now = Date.now()): Promise<KeyInfo | null> {
    const hash = hashApiKey(key);
    const cached = this.#cache.get(hash);
    if (cached && cached.expires > now) return cached.info;

    let pending = this.#inflight.get(hash);
    if (!pending) {
      pending = this.#load(hash, now).finally(() => this.#inflight.delete(hash));
      this.#inflight.set(hash, pending);
    }
    const info = await pending;
    if (this.#ttlMs > 0) this.#cache.set(hash, { info, expires: now + this.#ttlMs });
    return info;
  }

  clear(): void {
    this.#cache.clear();
  }

  async #load(hash: string, now: number): Promise<KeyInfo | null> {
    const [row] = await this.#db
      .select({
        keyId: apiKeys.id,
        userId: apiKeys.userId,
        revokedAt: apiKeys.revokedAt,
        emailVerifiedAt: users.emailVerifiedAt,
        planId: subscriptions.planId,
        status: subscriptions.status,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .leftJoin(subscriptions, eq(subscriptions.userId, apiKeys.userId))
      .where(eq(apiKeys.keyHash, hash))
      .limit(1);
    if (!row) return null;

    const paid = row.status !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(row.status);
    const plan = planById(paid ? row.planId : 'free');
    const monthStart = new Date(now).toISOString().slice(0, 8) + '01';
    const [usage] = await this.#db
      .select({ total: sql<string>`coalesce(sum(${usageDaily.count}), 0)` })
      .from(usageDaily)
      .innerJoin(apiKeys, eq(apiKeys.id, usageDaily.keyId))
      .where(and(eq(apiKeys.userId, row.userId), gte(usageDaily.date, monthStart)));

    return {
      keyId: row.keyId,
      userId: row.userId,
      planId: plan.id,
      monthlyQuota: plan.monthlyQuota,
      emailVerified: row.emailVerifiedAt !== null,
      revoked: row.revokedAt !== null,
      storedMonthUsage: Number(usage?.total ?? 0),
    };
  }
}
