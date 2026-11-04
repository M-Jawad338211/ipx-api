/**
 * API keys, anonymous rate limits, monthly quotas, usage accounting and batch lookups.
 * Needs the docker compose Postgres and Redis (docker compose up -d postgres redis).
 */
import { apiKeys, createDb, generateApiKey, subscriptions, usageDaily, users } from '@ipx/db';
import { prepareTestDatabase } from '@ipx/db/testing';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertDataPresent, createTestApp } from './helpers.ts';

/** Loose shape of JSON bodies inspected below. */
type Body = { error: { code: string; message: string }; services: unknown; results: unknown[] };

const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/15';
let DATABASE_URL: string;
let database: ReturnType<typeof createDb>;
let redis: Redis;
const apps: FastifyInstance[] = [];

async function appWith(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const app = await createTestApp({
    env: {
      DATABASE_URL,
      REDIS_URL,
      KEY_CACHE_SECONDS: '0',
      ANON_LIMIT_PER_MINUTE: '3',
      ANON_LIMIT_PER_DAY: '5',
      ...env,
    },
  });
  apps.push(app);
  return app;
}

let ipCounter = 0;
/** A fresh caller address per test so anonymous limits do not leak between tests. */
function nextCaller(): string {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function createUser(opts: { verified?: boolean; plan?: string } = {}) {
  const [user] = await database.db
    .insert(users)
    .values({
      email: `user${Date.now()}${Math.random()}@example.com`,
      passwordHash: 'x',
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    })
    .returning();
  if (opts.plan) {
    await database.db
      .insert(subscriptions)
      .values({ userId: user!.id, planId: opts.plan, status: 'active' });
  }
  const key = generateApiKey();
  const [row] = await database.db
    .insert(apiKeys)
    .values({ userId: user!.id, name: 'test', prefix: key.prefix, keyHash: key.hash })
    .returning();
  return { user: user!, key: key.key, keyId: row!.id };
}

beforeAll(async () => {
  assertDataPresent();
  DATABASE_URL = await prepareTestDatabase('ipx_test_api');
  database = createDb(DATABASE_URL, { max: 2 });
  redis = new Redis(REDIS_URL, { lazyConnect: true });
  await redis.connect().catch((error: unknown) => {
    throw new Error(
      `Cannot reach Redis at ${REDIS_URL}. Start it with: docker compose up -d redis`,
      {
        cause: error,
      },
    );
  });
});

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await redis?.quit();
  await database?.close();
});

describe('anonymous limits', () => {
  it('reports X-RateLimit headers and answers 429 with Retry-After past the per-minute limit', async () => {
    const app = await appWith();
    const remoteAddress = nextCaller();
    const remaining: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ url: '/json/8.8.8.8?fields=ip', remoteAddress });
      expect(res.statusCode).toBe(200);
      remaining.push(String(res.headers['x-ratelimit-remaining']));
    }
    expect(remaining).toEqual(['2', '1', '0']);
    const blocked = await app.inject({ url: '/json/8.8.8.8', remoteAddress });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ success: false, error: { code: 'rate_limited' } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['x-ratelimit-limit']).toBe('3');
    expect(Number(blocked.headers['x-ratelimit-reset'])).toBeGreaterThan(Date.now() / 1000);
    expect(blocked.headers['access-control-expose-headers']).toContain('X-RateLimit-Remaining');
  });

  it('enforces the per-day limit too', async () => {
    const app = await appWith({ ANON_LIMIT_PER_MINUTE: '100', ANON_LIMIT_PER_DAY: '2' });
    const remoteAddress = nextCaller();
    expect((await app.inject({ url: '/json/1.1.1.1', remoteAddress })).statusCode).toBe(200);
    expect((await app.inject({ url: '/json/1.1.1.1', remoteAddress })).statusCode).toBe(200);
    const blocked = await app.inject({ url: '/json/1.1.1.1', remoteAddress });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<Body>().error.message).toMatch(/per day/);
  });

  it('limits IPv6 callers per /64 and keeps other callers independent', async () => {
    const app = await appWith({ ANON_LIMIT_PER_MINUTE: '2' });
    const a = await app.inject({ url: '/json/8.8.8.8', remoteAddress: '2001:db8:1:2::1' });
    const b = await app.inject({ url: '/json/8.8.8.8', remoteAddress: '2001:db8:1:2:ffff::9' });
    const c = await app.inject({ url: '/json/8.8.8.8', remoteAddress: '2001:db8:1:2::abcd' });
    const other = await app.inject({ url: '/json/8.8.8.8', remoteAddress: '2001:db8:1:3::1' });
    expect([a.statusCode, b.statusCode, c.statusCode, other.statusCode]).toEqual([
      200, 200, 429, 200,
    ]);
  });

  it('applies to the caller lookup and JSONP as well', async () => {
    const app = await appWith({ ANON_LIMIT_PER_MINUTE: '1' });
    const remoteAddress = nextCaller();
    expect((await app.inject({ url: '/v1/json', remoteAddress })).statusCode).toBe(200);
    const jsonp = await app.inject({ url: '/v1/json?callback=cb', remoteAddress });
    expect(jsonp.statusCode).toBe(200);
    expect(jsonp.body).toContain('"code":"rate_limited"');
  });

  it('fails open when Redis is unreachable', async () => {
    const app = await appWith({ REDIS_URL: 'redis://127.0.0.1:1' });
    const res = await app.inject({ url: '/json/8.8.8.8?fields=ip', remoteAddress: nextCaller() });
    expect(res.statusCode).toBe(200);
    const health = await app.inject('/health');
    expect(health.json<Body>().services).toEqual({ redis: 'error', database: 'ok' });
  });
});

describe('API keys', () => {
  it('accepts ?key= and Authorization: Bearer and reports the monthly quota', async () => {
    const app = await appWith();
    const { key } = await createUser();
    const viaQuery = await app.inject({ url: `/json/8.8.8.8?fields=ip&key=${key}` });
    expect(viaQuery.statusCode).toBe(200);
    expect(viaQuery.headers['x-ratelimit-limit']).toBe('10000');
    expect(viaQuery.headers['x-ratelimit-remaining']).toBe('9999');
    const viaHeader = await app.inject({
      url: '/v1/json/8.8.8.8?fields=ip',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(viaHeader.statusCode).toBe(200);
    expect(viaHeader.headers['x-ratelimit-remaining']).toBe('9998');
    // Reset is the first second of next month (UTC).
    const now = new Date();
    expect(Number(viaHeader.headers['x-ratelimit-reset'])).toBe(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) / 1000,
    );
  });

  it('is not subject to the anonymous per-IP limits', async () => {
    const app = await appWith({ ANON_LIMIT_PER_MINUTE: '1' });
    const { key } = await createUser();
    const remoteAddress = nextCaller();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ url: `/json/8.8.8.8?key=${key}`, remoteAddress });
      expect(res.statusCode).toBe(200);
    }
  });

  it('uses the quota of the paid plan', async () => {
    const app = await appWith();
    const { key } = await createUser({ plan: 'pro' });
    const res = await app.inject({ url: `/json/8.8.8.8?key=${key}` });
    expect(res.headers['x-ratelimit-limit']).toBe('1000000');
  });

  it.each([
    ['malformed', 'not-a-key', 'Invalid API key'],
    ['unknown', `ipx_${'A'.repeat(32)}`, 'Invalid API key'],
  ])('rejects a %s key with 401', async (_label, key, message) => {
    const app = await appWith();
    const res = await app.inject({ url: `/json/8.8.8.8?key=${key}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ success: false, error: { code: 'unauthorized', message } });
  });

  it('rejects a revoked key', async () => {
    const app = await appWith();
    const { key, keyId } = await createUser();
    expect((await app.inject({ url: `/json/8.8.8.8?key=${key}` })).statusCode).toBe(200);
    await database.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId));
    const res = await app.inject({ url: `/json/8.8.8.8?key=${key}` });
    expect(res.statusCode).toBe(401);
    expect(res.json<Body>().error.message).toMatch(/revoked/);
  });

  it('requires a confirmed email only when email verification is enabled', async () => {
    const { key } = await createUser({ verified: false });
    const withoutResend = await appWith();
    expect((await withoutResend.inject({ url: `/json/8.8.8.8?key=${key}` })).statusCode).toBe(200);

    const withResend = await appWith({ RESEND_API_KEY: 're_test' });
    const res = await withResend.inject({ url: `/json/8.8.8.8?key=${key}` });
    expect(res.statusCode).toBe(401);
    expect(res.json<Body>().error.message).toMatch(/Confirm your email/);
  });

  it('answers 429 once the monthly quota is used up', async () => {
    const app = await appWith();
    const { key, user } = await createUser();
    const month = new Date().toISOString().slice(0, 7);
    await redis.set(`quota:${user.id}:${month}`, '9999');
    expect((await app.inject({ url: `/json/8.8.8.8?key=${key}` })).statusCode).toBe(200);
    const blocked = await app.inject({ url: `/json/8.8.8.8?key=${key}` });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<Body>().error.message).toMatch(/Monthly quota of 10,000 lookups reached/);
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('seeds the quota from Postgres when Redis has no counter (e.g. after a restart)', async () => {
    const app = await appWith();
    const { key, keyId } = await createUser();
    await database.db
      .insert(usageDaily)
      .values({ keyId, date: new Date().toISOString().slice(0, 10), count: 10_000 });
    const res = await app.inject({ url: `/json/8.8.8.8?key=${key}` });
    expect(res.statusCode).toBe(429);
  });

  it('answers 503 for keys when no database is configured', async () => {
    const app = await appWith({ DATABASE_URL: '' });
    const { key } = await createUser();
    const res = await app.inject({ url: `/json/8.8.8.8?key=${key}` });
    expect(res.statusCode).toBe(503);
    expect(res.json<Body>().error.code).toBe('service_unavailable');
  });
});

describe('usage accounting', () => {
  it('flushes per-key daily counts to usage_daily and stamps last_used_at', async () => {
    const app = await appWith();
    const { key, keyId } = await createUser();
    for (let i = 0; i < 4; i++) await app.inject({ url: `/json/8.8.8.8?key=${key}` });
    await app.inject({
      method: 'POST',
      url: `/v1/batch?key=${key}`,
      payload: { ips: ['1.1.1.1', '9.9.9.9', 'bogus'] },
    });

    expect(await app.services.usage!.flush()).toBe(7);
    const rows = await database.db.select().from(usageDaily).where(eq(usageDaily.keyId, keyId));
    expect(rows).toEqual([{ keyId, date: new Date().toISOString().slice(0, 10), count: 7 }]);
    const [row] = await database.db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
    expect(row!.lastUsedAt).toBeInstanceOf(Date);

    // Later requests add to the same row; an empty flush writes nothing.
    await app.inject({ url: `/json/8.8.8.8?key=${key}` });
    expect(await app.services.usage!.flush()).toBe(1);
    expect(await app.services.usage!.flush()).toBe(0);
    const [updated] = await database.db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.keyId, keyId));
    expect(updated!.count).toBe(8);
  });

  it('does not count anonymous requests', async () => {
    const app = await appWith();
    await app.inject({ url: '/json/8.8.8.8', remoteAddress: nextCaller() });
    expect(await app.services.usage!.flush()).toBe(0);
  });
});

describe('POST /v1/batch', () => {
  it('rejects anonymous callers', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/batch',
      payload: { ips: ['8.8.8.8'] },
      remoteAddress: nextCaller(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('returns one result per input, in order, with item errors for invalid input', async () => {
    const app = await appWith();
    const { key } = await createUser();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/batch?fields=ip,location.country_code,network.asn',
      headers: { authorization: `Bearer ${key}` },
      payload: { ips: ['8.8.8.8', 'nope', '2001:4860:4860::8888', '10.0.0.1'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-remaining']).toBe('9996');
    expect(res.json()).toEqual({
      success: true,
      count: 4,
      results: [
        { success: true, ip: '8.8.8.8', location: { country_code: 'US' }, network: { asn: 15169 } },
        {
          success: false,
          ip: 'nope',
          error: { code: 'invalid_ip', message: 'Not a valid IPv4 or IPv6 address' },
        },
        {
          success: true,
          ip: '2001:4860:4860::8888',
          location: { country_code: 'US' },
          network: { asn: 15169 },
        },
        { success: true, ip: '10.0.0.1', location: { country_code: null }, network: { asn: null } },
      ],
    });
  });

  it('returns full lookup objects without fields=', async () => {
    const app = await appWith();
    const { key } = await createUser();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/batch?key=${key}`,
      payload: { ips: ['8.8.8.8'] },
    });
    expect(res.json<Body>().results[0]).toMatchObject({
      success: true,
      reserved: false,
      network: { asn: 15169 },
      security: { is_hosting: true },
    });
  });

  it.each([
    ['more than 100 addresses', { ips: Array.from({ length: 101 }, () => '8.8.8.8') }],
    ['an empty list', { ips: [] }],
    ['a missing ips field', { addresses: ['8.8.8.8'] }],
  ])('rejects %s with invalid_request', async (_label, payload) => {
    const app = await appWith();
    const { key } = await createUser();
    const res = await app.inject({ method: 'POST', url: `/v1/batch?key=${key}`, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('charges every address against the quota', async () => {
    const app = await appWith();
    const { key, user } = await createUser();
    const month = new Date().toISOString().slice(0, 7);
    await redis.set(`quota:${user.id}:${month}`, '9998');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/batch?key=${key}`,
      payload: { ips: ['8.8.8.8', '1.1.1.1', '9.9.9.9'] },
    });
    expect(res.statusCode).toBe(429);
  });

  it('answers CORS preflight requests', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'OPTIONS', url: '/v1/batch' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });
});
