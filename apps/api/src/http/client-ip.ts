import type { IncomingHttpHeaders } from 'node:http';
import { parseIp } from '../ip.ts';

export type TrustedProxy = 'none' | 'cloudflare';

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The caller's IP. Proxy headers are only trusted with TRUSTED_PROXY=cloudflare (the API is then
 * reachable only through Cloudflare Tunnel): CF-Connecting-IP first, then the last
 * X-Forwarded-For entry (the one Cloudflare appended). Otherwise the socket address is used.
 */
export function clientIp(
  headers: IncomingHttpHeaders,
  socketAddress: string | undefined,
  trustedProxy: TrustedProxy,
): string {
  if (trustedProxy === 'cloudflare') {
    const cf = header(headers, 'cf-connecting-ip')?.trim();
    if (cf && parseIp(cf)) return cf;
    const forwarded = header(headers, 'x-forwarded-for');
    if (forwarded) {
      const last = forwarded.split(',').pop()?.trim();
      if (last && parseIp(last)) return last;
    }
  }
  return socketAddress ?? '';
}

/** True when a request carries any proxy header, i.e. it did not come straight from a local process. */
export function hasForwardingHeaders(headers: IncomingHttpHeaders): boolean {
  return (
    headers['cf-connecting-ip'] !== undefined ||
    headers['x-forwarded-for'] !== undefined ||
    headers['x-real-ip'] !== undefined ||
    headers.forwarded !== undefined
  );
}
