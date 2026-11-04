import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(REPO_ROOT, 'data'));

// Some sources (the Microsoft download page) reject requests without a browser-like user agent.
const BROWSER_UA = 'Mozilla/5.0 (compatible; ipx-data-updater/1.0)';

export function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

export function warn(message: string): void {
  console.warn(`[${new Date().toISOString()}] WARN ${message}`);
}

/** Removes secrets (e.g. `?token=...`) from URLs before they are logged. */
export function redact(url: string): string {
  return url.replace(/([?&](token|key|license_key)=)[^&]+/gi, '$1***');
}

export class HttpError extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`HTTP ${status} for ${redact(url)}`);
    this.status = status;
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  /** Statuses that are returned to the caller instead of being retried/thrown (e.g. 404). */
  passStatuses?: number[];
}

/** fetch() with a timeout, a browser-like user agent and retries on network errors / 5xx. */
export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 120_000, retries = 3, passStatuses = [] } = opts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': BROWSER_UA, accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok || passStatuses.includes(res.status)) return res;
      await res.body?.cancel();
      lastError = new HttpError(url, res.status);
      if (res.status < 500 && res.status !== 429) break; // client errors are not retried
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await sleep(1000 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchText(url: string, opts?: FetchOptions): Promise<string> {
  return (await fetchWithRetry(url, opts)).text();
}

export async function fetchJson<T = unknown>(url: string, opts?: FetchOptions): Promise<T> {
  return (await fetchWithRetry(url, opts)).json() as Promise<T>;
}

export interface DownloadResult {
  bytes: number;
  sha256: string;
}

/**
 * Streams a response body to `dest` (optionally gunzipping it) and returns the size and sha256
 * of the bytes written. The caller is responsible for validating and renaming the file.
 */
export async function streamToFile(
  res: Response,
  dest: string,
  { gunzip = false }: { gunzip?: boolean } = {},
): Promise<DownloadResult> {
  if (!res.body) throw new Error('Response has no body');
  await mkdir(path.dirname(dest), { recursive: true });
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const source = Readable.fromWeb(res.body);
  if (gunzip) {
    await pipeline(source, createGunzip(), meter, createWriteStream(dest));
  } else {
    await pipeline(source, meter, createWriteStream(dest));
  }
  return { bytes, sha256: hash.digest('hex') };
}

/** Writes `data` to `dest` atomically (temp file in the same directory + rename). */
export async function writeFileAtomic(dest: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, dest);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Asks the running API to reload its data files. The API also re-checks data/ on a timer, so a
 * failure here only delays the reload; it is logged but not treated as an error.
 */
export async function notifyReload(): Promise<void> {
  const port = process.env.PORT || '8080';
  const url = process.env.RELOAD_URL || `http://127.0.0.1:${port}/internal/reload`;
  try {
    const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    if (res.ok) log(`API reload requested: ${url} -> ${res.status}`);
    else warn(`API reload request returned ${res.status} (${url})`);
  } catch (error) {
    warn(
      `API not reachable for reload (${url}): ${(error as Error).message}. It will pick up the new files on its next refresh.`,
    );
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true when `value` is a syntactically valid IPv4 or IPv6 CIDR (e.g. `10.0.0.0/8`). */
export function isCidr(value: string): boolean {
  const slash = value.indexOf('/');
  if (slash === -1) return false;
  const addr = value.slice(0, slash);
  const lenText = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(lenText)) return false;
  const len = Number(lenText);
  if (addr.includes(':')) return len <= 128 && isIpv6(addr);
  return len <= 32 && isIpv4(addr);
}

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);

export function isIpv4(value: string): boolean {
  return IPV4_RE.test(value);
}

export function isIpv6(value: string): boolean {
  // Lightweight structural check; the API does the strict parsing.
  return /^[0-9a-fA-F:.]+$/.test(value) && value.includes(':') && value.split('::').length <= 2;
}

/**
 * Posts a message to ALERT_WEBHOOK_URL (Slack or Discord incoming webhook: both `text` and
 * `content` are sent). Without the variable the alert is only printed. Never throws.
 */
export async function alert(message: string): Promise<void> {
  const text = `[ipx ${process.env.IPX_SERVER_NAME || process.env.HOSTNAME || 'server'}] ${message}`;
  console.error(`[${new Date().toISOString()}] ALERT ${text}`);
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) warn(`alert webhook answered ${res.status}`);
  } catch (error) {
    warn(`alert webhook failed: ${(error as Error).message}`);
  }
}
