/** IP corrections: submission, review and the override file the API loads. */
import { buildOverrides, createDb, corrections, users } from '@ipx/db';
import { prepareTestDatabase } from '@ipx/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountError } from '../server/accounts.ts';
import {
  correctionNetwork,
  countNewCorrections,
  isAdmin,
  listCorrections,
  normalizeIp,
  reviewCorrection,
  submitCorrection,
} from '../server/corrections.ts';

let database: ReturnType<typeof createDb>;
const db = () => database.db;
let reviewerId: string;

beforeAll(async () => {
  database = createDb(await prepareTestDatabase('ipx_test_web_corrections'), { max: 2 });
  const [admin] = await db()
    .insert(users)
    .values({ email: 'admin@example.com', passwordHash: 'x' })
    .returning();
  reviewerId = admin!.id;
});

afterAll(async () => {
  await database?.close();
});

describe('normalizeIp and correctionNetwork', () => {
  it.each([
    ['8.8.8.8', '8.8.8.8'],
    [' 2001:DB8:0:0:1:0:0:1 ', '2001:db8::1:0:0:1'],
    ['2a02:2028:0:0:0:0:0:1', '2a02:2028::1'],
    ['nope', null],
    ['256.1.1.1', null],
    ['fe80::1%eth0', null],
  ])('normalizes %j', (input, expected) => expect(normalizeIp(input)).toBe(expected));

  it('covers the address, its /24 or its /48', () => {
    expect(correctionNetwork('39.32.10.1', 'ip')).toBe('39.32.10.1/32');
    expect(correctionNetwork('39.32.10.1', 'network')).toBe('39.32.10.0/24');
    expect(correctionNetwork('2a02:2028:ab::1', 'ip')).toBe('2a02:2028:ab::1/128');
    expect(correctionNetwork('2a02:2028:ab::1', 'network')).toBe('2a02:2028:ab::/48');
  });
});

describe('submitCorrection', () => {
  it('stores a valid report with a hashed submitter address', async () => {
    const row = await submitCorrection(
      db(),
      {
        ip: '39.32.10.1',
        countryCode: 'pk',
        region: ' Punjab ',
        city: 'Lahore',
        note: 'office line',
      },
      '203.0.113.7',
    );
    expect(row).toMatchObject({
      ip: '39.32.10.1',
      countryCode: 'PK',
      region: 'Punjab',
      city: 'Lahore',
      status: 'new',
    });
    expect(row.submitterHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
  });

  it.each([
    [{ ip: 'garbage', countryCode: 'PK' }, /valid IPv4 or IPv6/],
    [{ ip: '1.2.3.4', countryCode: 'XX' }, /Choose a country/],
    [{ ip: '1.2.3.4', countryCode: 'PK', email: 'not-an-email' }, /valid email/],
    [{ ip: '1.2.3.4', countryCode: 'PK', city: 'x'.repeat(101) }, /too long/],
  ])('rejects invalid input %#', async (input, message) => {
    const promise = submitCorrection(db(), input, '203.0.113.7');
    await expect(promise).rejects.toBeInstanceOf(AccountError);
    await expect(promise).rejects.toThrow(message);
  });
});

describe('review and export', () => {
  it('turns accepted corrections into overrides; rejected ones are left out', async () => {
    await db().delete(corrections);
    const a = await submitCorrection(
      db(),
      { ip: '39.32.10.1', countryCode: 'PK', city: 'Lahore' },
      'x',
    );
    const b = await submitCorrection(
      db(),
      { ip: '2a02:2028:ab::1', countryCode: 'DE', city: 'Hamburg' },
      'x',
    );
    const c = await submitCorrection(db(), { ip: '8.8.8.8', countryCode: 'FR' }, 'x');
    expect(await countNewCorrections(db())).toBe(3);

    await reviewCorrection(db(), { id: a.id, reviewerId, decision: 'accepted', scope: 'network' });
    await reviewCorrection(db(), { id: b.id, reviewerId, decision: 'accepted' });
    await reviewCorrection(db(), { id: c.id, reviewerId, decision: 'rejected' });

    expect(await countNewCorrections(db())).toBe(0);
    expect((await listCorrections(db(), 'accepted')).map((r) => r.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    const [rejected] = await db().select().from(corrections).where(eq(corrections.id, c.id));
    expect(rejected).toMatchObject({ status: 'rejected', network: null, reviewedBy: reviewerId });

    const file = await buildOverrides(db());
    expect(file.overrides).toEqual([
      { network: '39.32.10.0/24', country_code: 'PK', region: null, city: 'Lahore' },
      { network: '2a02:2028:ab::1/128', country_code: 'DE', region: null, city: 'Hamburg' },
    ]);
  });

  it('fails for unknown corrections', async () => {
    await expect(
      reviewCorrection(db(), {
        id: '00000000-0000-0000-0000-000000000000',
        reviewerId,
        decision: 'accepted',
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('isAdmin', () => {
  it('reads ADMIN_EMAILS case-insensitively', () => {
    const env = { ADMIN_EMAILS: ' Owner@Example.com , ops@example.com' };
    expect(isAdmin('owner@example.com', env)).toBe(true);
    expect(isAdmin('OPS@example.com', env)).toBe(true);
    expect(isAdmin('someone@example.com', env)).toBe(false);
    expect(isAdmin('owner@example.com', {})).toBe(false);
  });
});
