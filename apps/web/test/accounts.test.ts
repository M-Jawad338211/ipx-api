/** Account logic against a real Postgres (docker compose up -d postgres). */
import { createHmac } from 'node:crypto';
import {
  apiKeys,
  createDb,
  emailVerificationCodes,
  hashApiKey,
  subscriptions,
  usageDaily,
} from '@ipx/db';
import { prepareTestDatabase } from '@ipx/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccountError,
  CODE_MAX_ATTEMPTS,
  MAX_ACTIVE_KEYS,
  canUseFeatures,
  createKey,
  createSession,
  currentPlan,
  dailyUsage,
  deleteSession,
  getSessionUser,
  issueVerificationCode,
  listKeys,
  logIn,
  monthUsage,
  revokeKey,
  signUp,
  verifyEmailCode,
} from '../server/accounts.ts';
import { handlePaddleEvent, paddleConfig, verifyPaddleSignature } from '../server/billing.ts';
import { hashPassword, verifyPassword } from '../server/password.ts';

let database: ReturnType<typeof createDb>;
const db = () => database.db;
let counter = 0;
const email = () => `person${Date.now()}-${++counter}@Example.com`;

beforeAll(async () => {
  database = createDb(await prepareTestDatabase('ipx_test_web'), { max: 2 });
});

afterAll(async () => {
  await database?.close();
});

async function expectAccountError(promise: Promise<unknown>, message: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(AccountError);
  await expect(promise).rejects.toThrow(message);
}

/** Captures the code that would be emailed. */
function mailbox() {
  const sent: { to: string; code: string }[] = [];
  return { sent, send: async (to: string, code: string) => void sent.push({ to, code }) };
}

describe('passwords', () => {
  it('hashes with scrypt and verifies', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('sign-up and login', () => {
  it('creates an unverified user with a normalized email', async () => {
    const address = email();
    const user = await signUp(db(), { email: `  ${address} `, password: 'password123' });
    expect(user.email).toBe(address.toLowerCase());
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).not.toContain('password123');
  });

  it('rejects invalid input and duplicate emails', async () => {
    await expectAccountError(
      signUp(db(), { email: 'nope', password: 'password123' }),
      /valid email/,
    );
    await expectAccountError(signUp(db(), { email: email(), password: 'short' }), /at least 8/);
    const address = email();
    await signUp(db(), { email: address, password: 'password123' });
    await expectAccountError(
      signUp(db(), { email: address.toUpperCase(), password: 'password123' }),
      /already exists/,
    );
  });

  it('logs in with the right password only', async () => {
    const address = email();
    await signUp(db(), { email: address, password: 'password123' });
    expect((await logIn(db(), { email: address, password: 'password123' })).email).toBe(
      address.toLowerCase(),
    );
    await expectAccountError(
      logIn(db(), { email: address, password: 'password124' }),
      /Wrong email or password/,
    );
    await expectAccountError(
      logIn(db(), { email: email(), password: 'password123' }),
      /Wrong email or password/,
    );
  });
});

describe('sessions', () => {
  it('resolves, expires and deletes sessions; only the token hash is stored', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const { token } = await createSession(db(), user.id);
    expect((await getSessionUser(db(), token))?.id).toBe(user.id);
    expect(await getSessionUser(db(), `${token}x`)).toBeNull();
    const in31Days = new Date(Date.now() + 31 * 86_400_000);
    expect(await getSessionUser(db(), token, in31Days)).toBeNull();
    await deleteSession(db(), token);
    expect(await getSessionUser(db(), token)).toBeNull();
  });
});

describe('email verification (OTP)', () => {
  it('sends a 6-digit code and confirms the email with it', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const box = mailbox();
    await issueVerificationCode(db(), user, box.send);
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]!.to).toBe(user.email);
    expect(box.sent[0]!.code).toMatch(/^\d{6}$/);

    await verifyEmailCode(db(), user.id, box.sent[0]!.code);
    const [rows] = await Promise.all([
      db().select().from(emailVerificationCodes).where(eq(emailVerificationCodes.userId, user.id)),
    ]);
    expect(rows).toEqual([]);
    const verified = await logIn(db(), { email: user.email, password: 'password123' });
    expect(verified.emailVerifiedAt).toBeInstanceOf(Date);
    expect(canUseFeatures(verified, true)).toBe(true);
    await expectAccountError(issueVerificationCode(db(), verified, box.send), /already confirmed/);
  });

  it('limits resends to one per minute and replaces the previous code', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const box = mailbox();
    const t0 = new Date();
    await issueVerificationCode(db(), user, box.send, t0);
    await expectAccountError(
      issueVerificationCode(db(), user, box.send, new Date(t0.getTime() + 30_000)),
      /wait 30 seconds/,
    );
    await issueVerificationCode(db(), user, box.send, new Date(t0.getTime() + 61_000));
    expect(box.sent).toHaveLength(2);
    if (box.sent[0]!.code !== box.sent[1]!.code) {
      await expectAccountError(
        verifyEmailCode(db(), user.id, box.sent[0]!.code, new Date(t0.getTime() + 62_000)),
        /Wrong code/,
      );
    }
    await verifyEmailCode(db(), user.id, box.sent[1]!.code, new Date(t0.getTime() + 63_000));
  });

  it('drops the code and explains when the email cannot be sent', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const failing = async () => {
      throw new Error('Resend answered 401');
    };
    await expectAccountError(
      issueVerificationCode(db(), user, failing),
      /could not send the email/,
    );
    const rows = await db()
      .select()
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.userId, user.id));
    expect(rows).toEqual([]);
    // No resend wait after a failed send.
    const box = mailbox();
    await issueVerificationCode(db(), user, box.send);
    expect(box.sent).toHaveLength(1);
  });

  it('rejects expired codes', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const box = mailbox();
    const t0 = new Date();
    await issueVerificationCode(db(), user, box.send, t0);
    await expectAccountError(
      verifyEmailCode(db(), user.id, box.sent[0]!.code, new Date(t0.getTime() + 11 * 60_000)),
      /expired/,
    );
  });

  it(`locks the code after ${CODE_MAX_ATTEMPTS} wrong attempts`, async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const box = mailbox();
    await issueVerificationCode(db(), user, box.send);
    const wrong = box.sent[0]!.code === '000000' ? '111111' : '000000';
    for (let i = 1; i <= CODE_MAX_ATTEMPTS; i++) {
      await expectAccountError(verifyEmailCode(db(), user.id, wrong), /Wrong code/);
    }
    await expectAccountError(
      verifyEmailCode(db(), user.id, box.sent[0]!.code),
      /Too many wrong attempts/,
    );
  });

  it('validates the code format and requires a pending code', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    await expectAccountError(verifyEmailCode(db(), user.id, '12ab'), /6-digit/);
    await expectAccountError(verifyEmailCode(db(), user.id, '123456'), /No code is pending/);
  });

  it('gates features only when verification is required', () => {
    expect(canUseFeatures({ emailVerifiedAt: null }, false)).toBe(true);
    expect(canUseFeatures({ emailVerifiedAt: null }, true)).toBe(false);
    expect(canUseFeatures({ emailVerifiedAt: new Date() }, true)).toBe(true);
  });
});

describe('API keys', () => {
  it('creates a key whose secret is shown once and stored only as a hash', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const created = await createKey(db(), user.id, '  Production ');
    expect(created.name).toBe('Production');
    expect(created.key).toMatch(/^ipx_[A-Za-z0-9_-]{32}$/);
    expect(created.prefix).toBe(created.key.slice(0, 12));
    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.id, created.id));
    expect(row!.keyHash).toBe(hashApiKey(created.key));
    expect(JSON.stringify(row)).not.toContain(created.key);
    expect((await listKeys(db(), user.id)).map((k) => k.name)).toEqual(['Production']);
  });

  it('revokes keys of the owner only', async () => {
    const owner = await signUp(db(), { email: email(), password: 'password123' });
    const other = await signUp(db(), { email: email(), password: 'password123' });
    const key = await createKey(db(), owner.id, 'a');
    await expectAccountError(revokeKey(db(), other.id, key.id), /not found/);
    await revokeKey(db(), owner.id, key.id);
    expect(await listKeys(db(), owner.id)).toEqual([]);
    await expectAccountError(revokeKey(db(), owner.id, key.id), /not found/);
  });

  it(`allows at most ${MAX_ACTIVE_KEYS} active keys`, async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    for (let i = 0; i < MAX_ACTIVE_KEYS; i++) await createKey(db(), user.id, `k${i}`);
    await expectAccountError(createKey(db(), user.id, 'one more'), /up to 10 active keys/);
  });
});

describe('usage and plan', () => {
  it('sums usage per day and per month across keys', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const a = await createKey(db(), user.id, 'a');
    const b = await createKey(db(), user.id, 'b');
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await db()
      .insert(usageDaily)
      .values([
        { keyId: a.id, date: today, count: 5 },
        { keyId: b.id, date: today, count: 7 },
        { keyId: a.id, date: yesterday, count: 3 },
      ]);
    const days = await dailyUsage(db(), user.id, 30);
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toEqual({ date: today, count: 12 });
    expect(days.at(-2)).toEqual({ date: yesterday, count: 3 });
    expect(days.slice(0, -2).every((d) => d.count === 0)).toBe(true);
    const expectedMonth = yesterday.slice(0, 7) === today.slice(0, 7) ? 15 : 12;
    expect(await monthUsage(db(), user.id)).toBe(expectedMonth);
  });

  it('defaults to the free plan', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    expect((await currentPlan(db(), user.id)).plan.id).toBe('free');
  });
});

describe('Paddle billing', () => {
  const secret = 'pdl_ntfset_test_secret';
  const sign = (body: string, ts: number) =>
    `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

  it('verifies webhook signatures', () => {
    const body = '{"event_type":"subscription.created"}';
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyPaddleSignature(body, sign(body, ts), secret)).toBe(true);
    expect(verifyPaddleSignature(`${body} `, sign(body, ts), secret)).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, ts), 'other secret')).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, ts - 600), secret)).toBe(false); // too old
    expect(verifyPaddleSignature(body, null, secret)).toBe(false);
    expect(verifyPaddleSignature(body, 'ts=abc;h1=zz', secret)).toBe(false);
  });

  it('is disabled unless PAYMENTS_ENABLED=true and a client token is set', () => {
    expect(paddleConfig({})).toBeNull();
    expect(paddleConfig({ PAYMENTS_ENABLED: 'true' })).toBeNull();
    expect(
      paddleConfig({
        PAYMENTS_ENABLED: 'true',
        PADDLE_CLIENT_TOKEN: 'test_x',
        PADDLE_PRICE_PRO: 'pri_pro',
      }),
    ).toMatchObject({ environment: 'sandbox', prices: { pro: 'pri_pro' } });
  });

  it('maps subscription events to the plan of the price', async () => {
    const user = await signUp(db(), { email: email(), password: 'password123' });
    const prices = { starter: 'pri_starter', pro: 'pri_pro' };
    const event = (eventType: string, status: string, priceId = 'pri_pro') => ({
      event_type: eventType,
      data: {
        id: 'sub_123',
        status,
        customer_id: 'ctm_1',
        custom_data: { user_id: user.id },
        items: [{ price: { id: priceId } }],
        current_billing_period: { ends_at: '2026-12-04T00:00:00Z' },
      },
    });
    expect(await handlePaddleEvent(db(), event('subscription.created', 'active'), prices)).toMatch(
      /-> pro/,
    );
    expect((await currentPlan(db(), user.id)).plan.id).toBe('pro');

    await handlePaddleEvent(db(), event('subscription.updated', 'active', 'pri_starter'), prices);
    expect((await currentPlan(db(), user.id)).plan.id).toBe('starter');

    await handlePaddleEvent(
      db(),
      event('subscription.canceled', 'canceled', 'pri_starter'),
      prices,
    );
    const after = await currentPlan(db(), user.id);
    expect(after).toMatchObject({ plan: { id: 'free' }, status: 'canceled' });
    const rows = await db().select().from(subscriptions).where(eq(subscriptions.userId, user.id));
    expect(rows).toHaveLength(1);

    expect(await handlePaddleEvent(db(), { ...event('transaction.paid', 'paid') }, prices)).toMatch(
      /ignored/,
    );
    expect(
      await handlePaddleEvent(db(), event('subscription.created', 'active', 'pri_unknown'), prices),
    ).toMatch(/unknown price/);
  });
});
