import { IP_LOOKUP_FIELDS } from '@ipx/shared';
import { HttpError } from './errors.ts';

const KNOWN_FIELDS: ReadonlySet<string> = new Set(IP_LOOKUP_FIELDS);
const CALLBACK_RE = /^[A-Za-z_$][\w$.]{0,63}$/;

/**
 * Parses `fields=ip,location.city,security`. Returns null when no filtering was requested.
 * Unknown names are rejected so typos do not silently return less data.
 */
export function parseFields(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const fields = [
    ...new Set(
      value
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
    ),
  ];
  if (fields.length === 0) return null;
  const unknown = fields.filter((f) => !KNOWN_FIELDS.has(f));
  if (unknown.length > 0) {
    throw new HttpError(
      400,
      'invalid_request',
      `Unknown field${unknown.length > 1 ? 's' : ''} in fields=: ${unknown.join(', ')}`,
    );
  }
  return fields;
}

/**
 * Copies only the requested paths into a new object, keeping the schema's key order.
 * `success` is always included so clients can tell results from errors.
 */
export function pickFields(source: object, fields: readonly string[]): Record<string, unknown> {
  const wanted = new Set(['success', ...fields]);
  return pick(source as Record<string, unknown>, wanted, '');
}

function pick(
  source: Record<string, unknown>,
  wanted: ReadonlySet<string>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (wanted.has(path)) {
      out[key] = value;
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      [...wanted].some((w) => w.startsWith(`${path}.`))
    ) {
      out[key] = pick(value as Record<string, unknown>, wanted, path);
    }
  }
  return out;
}

export function isValidCallback(name: string): boolean {
  return CALLBACK_RE.test(name);
}

/**
 * JSONP body. The comment prefix and `typeof` guard are the usual defences (Rosetta Flash,
 * missing callback); U+2028/U+2029 are escaped because they end lines in older JS engines.
 */
export function jsonpBody(callback: string, payload: unknown): string {
  const json = JSON.stringify(payload)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `/**/ typeof ${callback} === 'function' && ${callback}(${json});`;
}
