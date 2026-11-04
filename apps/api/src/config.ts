import path from 'node:path';
import { ANONYMOUS_LIMITS, emailVerificationRequired } from '@ipx/db';
import type { TrustedProxy } from './http/client-ip.ts';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  trustedProxy: TrustedProxy;
  logLevel: string;
  /** One log line per request. Off by default: request logs contain client IP addresses. */
  logRequests: boolean;
  /** Seconds between checks of data/ for changed files; 0 disables the timer. */
  refreshSeconds: number;
  /** Load every timezone polygon at startup (~1.2 GB RSS) instead of lazily (~60 MB). */
  tzPreload: boolean;
  /** Base URL advertised in the OpenAPI document. */
  publicUrl: string;
  /** Postgres (API keys, plans, usage). Without it, requests with a key get 503. */
  databaseUrl: string | null;
  /** Redis (rate limits, quotas, usage counters). Without it, limits are not enforced. */
  redisUrl: string | null;
  /** Anonymous limits per client IP (IPv6: per /64). */
  anonPerMinute: number;
  anonPerDay: number;
  /** Seconds an API key lookup is cached in memory (revocations take up to this long). */
  keyCacheSeconds: number;
  /** Seconds between usage flushes from Redis to Postgres. */
  usageFlushSeconds: number;
  /** Keys of accounts with an unconfirmed email are rejected (true when RESEND_API_KEY is set). */
  emailVerificationRequired: boolean;
  /** Bearer token for GET /metrics; without it only local processes may scrape. */
  metricsToken: string | null;
}

/** <repo>/data, resolved from this file so it works from any working directory. */
export const DEFAULT_DATA_DIR = path.resolve(import.meta.dirname, '../../../data');

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

function bool(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false, got "${value}"`);
}

function int(value: string | undefined, fallback: number, name: string, min: number, max: number) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${value}"`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const trustedProxy = (env.TRUSTED_PROXY || 'none').toLowerCase();
  if (trustedProxy !== 'none' && trustedProxy !== 'cloudflare') {
    throw new Error(`TRUSTED_PROXY must be "none" or "cloudflare", got "${env.TRUSTED_PROXY}"`);
  }
  const logLevel = (env.LOG_LEVEL || 'info').toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) throw new Error(`LOG_LEVEL "${env.LOG_LEVEL}" is not valid`);
  const port = int(env.PORT, 8080, 'PORT', 1, 65535);

  return {
    host: env.HOST || '0.0.0.0',
    port,
    dataDir: path.resolve(env.DATA_DIR || DEFAULT_DATA_DIR),
    trustedProxy,
    logLevel,
    logRequests: bool(env.LOG_REQUESTS, false, 'LOG_REQUESTS'),
    refreshSeconds: int(env.DATA_REFRESH_SECONDS, 60, 'DATA_REFRESH_SECONDS', 0, 86_400),
    tzPreload: bool(env.TZ_PRELOAD, false, 'TZ_PRELOAD'),
    publicUrl: (env.PUBLIC_API_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    databaseUrl: env.DATABASE_URL || null,
    redisUrl: env.REDIS_URL || null,
    anonPerMinute: int(
      env.ANON_LIMIT_PER_MINUTE,
      ANONYMOUS_LIMITS.perMinute,
      'ANON_LIMIT_PER_MINUTE',
      1,
      1e9,
    ),
    anonPerDay: int(env.ANON_LIMIT_PER_DAY, ANONYMOUS_LIMITS.perDay, 'ANON_LIMIT_PER_DAY', 1, 1e9),
    keyCacheSeconds: int(env.KEY_CACHE_SECONDS, 60, 'KEY_CACHE_SECONDS', 0, 3600),
    usageFlushSeconds: int(env.USAGE_FLUSH_SECONDS, 60, 'USAGE_FLUSH_SECONDS', 1, 3600),
    emailVerificationRequired: emailVerificationRequired(env),
    metricsToken: env.METRICS_TOKEN || null,
  };
}
