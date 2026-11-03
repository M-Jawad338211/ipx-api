import path from 'node:path';
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
  };
}
