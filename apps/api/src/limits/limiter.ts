import type { Redis } from 'ioredis';

/**
 * Redis-backed limits, each a single atomic Lua call per request:
 *  - anonymous callers: sliding-window counters (per minute and per day) keyed by client IP;
 *  - API keys: a monthly quota per account plus the per-key daily usage counter that the
 *    flusher moves to Postgres.
 */

// Sliding window counter: estimate = previous window * (unelapsed share) + current window.
// KEYS: cur1, prev1, cur2, prev2, ...   ARGV: now, cost, then (size, limit, windowStart) per window
const SLIDING_WINDOW = `
local now = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local windows = (#ARGV - 2) / 3
local result = { 1 }
local estimates = {}
for i = 1, windows do
  local size = tonumber(ARGV[3 + (i - 1) * 3])
  local limit = tonumber(ARGV[4 + (i - 1) * 3])
  local start = tonumber(ARGV[5 + (i - 1) * 3])
  local cur = tonumber(redis.call('GET', KEYS[i * 2 - 1]) or '0')
  local prev = tonumber(redis.call('GET', KEYS[i * 2]) or '0')
  local estimate = prev * ((size - (now - start)) / size) + cur
  estimates[i] = estimate
  if estimate + cost > limit then result[1] = 0 end
end
for i = 1, windows do
  local size = tonumber(ARGV[3 + (i - 1) * 3])
  local limit = tonumber(ARGV[4 + (i - 1) * 3])
  local used = estimates[i]
  if result[1] == 1 then
    redis.call('INCRBY', KEYS[i * 2 - 1], cost)
    redis.call('PEXPIRE', KEYS[i * 2 - 1], size * 2)
    used = used + cost
  end
  result[i + 1] = math.max(0, math.floor(limit - used))
end
return result
`;

// KEYS: quota counter, pending usage hash   ARGV: cost, quota, seed, ttl seconds, hash field
const QUOTA = `
redis.call('SET', KEYS[1], ARGV[3], 'NX', 'EX', ARGV[4])
local used = tonumber(redis.call('GET', KEYS[1]))
local cost = tonumber(ARGV[1])
local quota = tonumber(ARGV[2])
if used + cost > quota then return { 0, used } end
used = redis.call('INCRBY', KEYS[1], cost)
redis.call('HINCRBY', KEYS[2], ARGV[5], cost)
return { 1, used }
`;

export const USAGE_PENDING_KEY = 'usage:pending';

interface LimiterCommands {
  slidingWindow(...args: (string | number)[]): Promise<number[]>;
  monthlyQuota(...args: (string | number)[]): Promise<number[]>;
}

export interface LimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix time (seconds) when the reported window resets. */
  reset: number;
}

export interface WindowSpec {
  name: string;
  sizeMs: number;
  limit: number;
}

export class Limiter {
  readonly #redis: Redis & LimiterCommands;

  constructor(redis: Redis) {
    redis.defineCommand('slidingWindow', { lua: SLIDING_WINDOW });
    redis.defineCommand('monthlyQuota', { lua: QUOTA, numberOfKeys: 2 });
    this.#redis = redis as Redis & LimiterCommands;
  }

  /**
   * Checks and (if allowed) consumes `cost` from every window. The decision reported in headers is
   * the window with the fewest requests left.
   */
  async slidingWindows(
    subject: string,
    windows: WindowSpec[],
    cost: number,
    now = Date.now(),
  ): Promise<LimitDecision> {
    const keys: string[] = [];
    const args: (string | number)[] = [now, cost];
    for (const w of windows) {
      const start = Math.floor(now / w.sizeMs) * w.sizeMs;
      keys.push(`rl:${w.name}:${subject}:${start}`, `rl:${w.name}:${subject}:${start - w.sizeMs}`);
      args.push(w.sizeMs, w.limit, start);
    }
    const result = await this.#redis.slidingWindow(keys.length, ...keys, ...args);
    let tightest = 0;
    for (let i = 1; i < windows.length; i++) {
      if (result[i + 1]! / windows[i]!.limit < result[tightest + 1]! / windows[tightest]!.limit) {
        tightest = i;
      }
    }
    const w = windows[tightest]!;
    const remaining = result[tightest + 1]!;
    // A denied request is retried once the current window has rolled over.
    const reset = Math.ceil((Math.floor(now / w.sizeMs) * w.sizeMs + w.sizeMs) / 1000);
    return { allowed: result[0] === 1, limit: w.limit, remaining, reset };
  }

  /**
   * Monthly quota of an account. `seed` (usage already stored in Postgres) initialises the counter
   * when Redis does not have it yet, e.g. after a Redis restart.
   */
  async monthlyQuota(opts: {
    userId: string;
    keyId: string;
    quota: number;
    cost: number;
    seed: number;
    now?: number;
  }): Promise<LimitDecision> {
    const now = new Date(opts.now ?? Date.now());
    const month = now.toISOString().slice(0, 7);
    const day = now.toISOString().slice(0, 10);
    const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const [allowed, used] = await this.#redis.monthlyQuota(
      `quota:${opts.userId}:${month}`,
      USAGE_PENDING_KEY,
      opts.cost,
      opts.quota,
      opts.seed,
      40 * 86_400,
      `${opts.keyId}|${day}`,
    );
    return {
      allowed: allowed === 1,
      limit: opts.quota,
      remaining: Math.max(0, opts.quota - used!),
      reset: Math.ceil(nextMonth / 1000),
    };
  }
}
