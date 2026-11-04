import type { FastifyReply, FastifyRequest } from 'fastify';
import { looksLikeApiKey, planById } from '@ipx/db';
import type { Config } from '../config.ts';
import { clientIp } from '../http/client-ip.ts';
import { HttpError } from '../http/errors.ts';
import { parseIp } from '../ip.ts';
import type { KeyResolver } from './keys.ts';
import type { LimitDecision, Limiter } from './limiter.ts';

export interface AccessServices {
  config: Config;
  limiter: Limiter | null;
  keys: KeyResolver | null;
}

export interface AccessGrant {
  kind: 'anonymous' | 'key';
  userId?: string;
  keyId?: string;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
let lastRedisWarning = 0;

/** `Authorization: Bearer <key>` or `?key=<key>`. */
export function extractApiKey(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim() || null;
  const key = (request.query as Record<string, unknown> | undefined)?.key;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/** Rate-limit subject for anonymous callers: the IP, or its /64 for IPv6 (one host owns a /64). */
export function anonymousSubject(address: string): string {
  const ip = parseIp(address);
  if (!ip) return address;
  if (ip.version === 4) return ip.text;
  return `${((ip.value >> 64n) << 64n).toString(16)}/64`;
}

function setLimitHeaders(reply: FastifyReply, decision: LimitDecision): void {
  reply.header('x-ratelimit-limit', decision.limit);
  reply.header('x-ratelimit-remaining', decision.remaining);
  reply.header('x-ratelimit-reset', decision.reset);
}

function denied(reply: FastifyReply, decision: LimitDecision, message: string): HttpError {
  reply.header('retry-after', Math.max(1, decision.reset - Math.floor(Date.now() / 1000)));
  return new HttpError(429, 'rate_limited', message);
}

function warnRedis(request: FastifyRequest, error: unknown): void {
  if (Date.now() - lastRedisWarning < 60_000) return;
  lastRedisWarning = Date.now();
  request.log.warn({ err: error }, 'redis unavailable: rate limits are not enforced');
}

/**
 * Authenticates the request and charges `cost` lookups against the caller's limits.
 * Throws HttpError (401, 429, 503) when the request must be refused.
 */
export async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AccessServices,
  { cost, requireKey }: { cost: number; requireKey: boolean },
): Promise<AccessGrant> {
  const { config, limiter, keys } = services;
  const key = extractApiKey(request);

  if (key === null) {
    if (requireKey) {
      throw new HttpError(
        401,
        'unauthorized',
        'This endpoint needs an API key: pass ?key= or an Authorization: Bearer header',
      );
    }
    if (!limiter) return { kind: 'anonymous' };
    const subject = anonymousSubject(
      clientIp(request.headers, request.socket.remoteAddress, config.trustedProxy),
    );
    let decision: LimitDecision;
    try {
      decision = await limiter.slidingWindows(
        `ip:${subject}`,
        [
          { name: 'm', sizeMs: MINUTE, limit: config.anonPerMinute },
          { name: 'd', sizeMs: DAY, limit: config.anonPerDay },
        ],
        cost,
      );
    } catch (error) {
      warnRedis(request, error);
      return { kind: 'anonymous' };
    }
    setLimitHeaders(reply, decision);
    if (!decision.allowed) {
      throw denied(
        reply,
        decision,
        `Anonymous rate limit reached (${config.anonPerMinute} per minute and ${config.anonPerDay.toLocaleString('en-US')} per day per IP). Use an API key for higher limits.`,
      );
    }
    return { kind: 'anonymous' };
  }

  if (!looksLikeApiKey(key)) throw new HttpError(401, 'unauthorized', 'Invalid API key');
  if (!keys) {
    throw new HttpError(503, 'service_unavailable', 'API keys cannot be checked right now');
  }
  let info;
  try {
    info = await keys.resolve(key);
  } catch (error) {
    request.log.error({ err: error }, 'api key lookup failed');
    throw new HttpError(503, 'service_unavailable', 'API keys cannot be checked right now');
  }
  if (!info) throw new HttpError(401, 'unauthorized', 'Invalid API key');
  if (info.revoked) throw new HttpError(401, 'unauthorized', 'This API key has been revoked');
  if (config.emailVerificationRequired && !info.emailVerified) {
    throw new HttpError(
      401,
      'unauthorized',
      'Confirm your email address in the dashboard before using this API key',
    );
  }

  if (limiter) {
    let decision: LimitDecision | null = null;
    try {
      decision = await limiter.monthlyQuota({
        userId: info.userId,
        keyId: info.keyId,
        quota: info.monthlyQuota,
        cost,
        seed: info.storedMonthUsage,
      });
    } catch (error) {
      warnRedis(request, error);
    }
    if (decision) {
      setLimitHeaders(reply, decision);
      if (!decision.allowed) {
        throw denied(
          reply,
          decision,
          `Monthly quota of ${info.monthlyQuota.toLocaleString('en-US')} lookups reached for the ${planById(info.planId).name} plan`,
        );
      }
    }
  }
  return { kind: 'key', userId: info.userId, keyId: info.keyId };
}
