/** IP location corrections: submission by visitors, review by admins. */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { corrections, type Database } from '@ipx/db';
import { COUNTRY_NAMES } from '@ipx/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AccountError } from './accounts.ts';

export type CorrectionStatus = 'new' | 'accepted' | 'rejected';
export type CorrectionScope = 'ip' | 'network';
export type Correction = typeof corrections.$inferSelect;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optional(
  value: string | undefined,
  max: number,
  field: AccountError['field'],
  label: string,
) {
  const text = value?.trim() ?? '';
  if (text.length > max)
    throw new AccountError(`${label} is too long (max ${max} characters)`, field);
  return text || null;
}

/** Expands an IPv6 address to its 8 groups. */
function ipv6Groups(ip: string): number[] {
  const [head = '', tail = ''] = ip.split('::');
  const parse = (part: string) => (part ? part.split(':').map((g) => parseInt(g, 16)) : []);
  const h = parse(head);
  const t = parse(tail);
  return ip.includes('::')
    ? [...h, ...new Array<number>(8 - h.length - t.length).fill(0), ...t]
    : h;
}

/** Normalizes the address; IPv4-mapped IPv6 and zone ids are rejected to keep it simple. */
export function normalizeIp(input: string): string | null {
  const ip = input.trim();
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version === 6 && !ip.includes('%') && !ip.includes('.')) {
    const groups = ipv6Groups(ip.toLowerCase());
    // RFC 5952: compress the longest run (2+ groups) of zeros.
    let best = { start: -1, length: 0 };
    for (let i = 0; i < 8;) {
      if (groups[i] !== 0) {
        i++;
        continue;
      }
      let j = i;
      while (j < 8 && groups[j] === 0) j++;
      if (j - i > best.length) best = { start: i, length: j - i };
      i = j;
    }
    const hex = groups.map((g) => g.toString(16));
    if (best.length < 2) return hex.join(':');
    return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.length).join(':')}`;
  }
  return null;
}

/** The range an accepted correction covers: the address itself, or its /24 (IPv4) / /48 (IPv6). */
export function correctionNetwork(ip: string, scope: CorrectionScope): string {
  if (isIP(ip) === 4) {
    if (scope === 'ip') return `${ip}/32`;
    return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  }
  if (scope === 'ip') return `${ip}/128`;
  const groups = ipv6Groups(ip)
    .slice(0, 3)
    .map((g) => g.toString(16));
  return `${groups.join(':')}::/48`;
}

export interface CorrectionInput {
  ip: string;
  countryCode: string;
  region?: string;
  city?: string;
  email?: string;
  note?: string;
}

export async function submitCorrection(
  db: Database,
  input: CorrectionInput,
  submitterIp: string,
): Promise<Correction> {
  const ip = normalizeIp(input.ip);
  if (!ip) throw new AccountError('Enter a valid IPv4 or IPv6 address', 'form');
  const countryCode = input.countryCode.trim().toUpperCase();
  if (!COUNTRY_NAMES[countryCode]) throw new AccountError('Choose a country', 'form');
  const email = optional(input.email, 254, 'email', 'Email');
  if (email && !EMAIL_RE.test(email))
    throw new AccountError('Enter a valid email address', 'email');
  const [row] = await db
    .insert(corrections)
    .values({
      ip,
      countryCode,
      region: optional(input.region, 100, 'form', 'Region'),
      city: optional(input.city, 100, 'form', 'City'),
      email,
      note: optional(input.note, 1000, 'form', 'Note'),
      submitterHash: createHash('sha256').update(`ipx-correction:${submitterIp}`).digest('hex'),
    })
    .returning();
  return row!;
}

export async function listCorrections(db: Database, status: CorrectionStatus, limit = 100) {
  return db
    .select()
    .from(corrections)
    .where(eq(corrections.status, status))
    .orderBy(desc(corrections.createdAt))
    .limit(limit);
}

export async function countNewCorrections(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(corrections)
    .where(eq(corrections.status, 'new'));
  return row?.n ?? 0;
}

export async function reviewCorrection(
  db: Database,
  input: {
    id: string;
    reviewerId: string;
    decision: 'accepted' | 'rejected';
    scope?: CorrectionScope;
  },
): Promise<Correction> {
  const [current] = await db.select().from(corrections).where(eq(corrections.id, input.id));
  if (!current) throw new AccountError('Correction not found');
  const [row] = await db
    .update(corrections)
    .set({
      status: input.decision,
      network:
        input.decision === 'accepted' ? correctionNetwork(current.ip, input.scope ?? 'ip') : null,
      reviewedAt: new Date(),
      reviewedBy: input.reviewerId,
    })
    .where(and(eq(corrections.id, input.id)))
    .returning();
  return row!;
}

/** Admins are listed in ADMIN_EMAILS (comma-separated). */
export function isAdmin(
  email: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const admins = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
