/**
 * Paddle Billing: client-side checkout (Paddle.js) and the subscription webhook. Everything is
 * inactive while PAYMENTS_ENABLED is not "true".
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLANS, subscriptions, users, type Database, type PlanDefinition } from '@ipx/db';
import { eq } from 'drizzle-orm';

export interface PaddleConfig {
  clientToken: string;
  environment: 'sandbox' | 'production';
  /** Paddle price id per paid plan. */
  prices: Partial<Record<PlanDefinition['id'], string>>;
}

export function paddleConfig(
  env: Record<string, string | undefined> = process.env,
): PaddleConfig | null {
  if (!/^(1|true|yes|on)$/i.test(env.PAYMENTS_ENABLED ?? '')) return null;
  const clientToken = env.PADDLE_CLIENT_TOKEN;
  if (!clientToken) return null;
  return {
    clientToken,
    environment: env.PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    prices: {
      pro: env.PADDLE_PRICE_PRO || undefined,
    },
  };
}

/**
 * Verifies the `Paddle-Signature` header ("ts=...;h1=..."): HMAC-SHA256 of "ts:rawBody" with
 * the webhook secret, at most `toleranceSeconds` old.
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  now = Date.now(),
  toleranceSeconds = 300,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(';').map((part) => {
      const [k, ...v] = part.split('=');
      return [k?.trim(), v.join('=').trim()];
    }),
  ) as Record<string, string>;
  const ts = Number(parts.ts);
  const h1 = parts.h1;
  if (!Number.isFinite(ts) || !h1 || !/^[0-9a-f]+$/i.test(h1)) return false;
  if (Math.abs(now / 1000 - ts) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${parts.ts}:${rawBody}`).digest();
  const actual = Buffer.from(h1, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface PaddleSubscriptionEvent {
  event_type: string;
  data: {
    id: string;
    status: string;
    customer_id?: string;
    custom_data?: { user_id?: string } | null;
    items?: { price?: { id?: string } }[];
    current_billing_period?: { ends_at?: string } | null;
  };
}

function planForPrice(priceId: string | undefined, prices: Record<string, string | undefined>) {
  return PLANS.find((plan) => priceId && prices[plan.id] === priceId) ?? null;
}

/**
 * Applies a subscription.* webhook event to the subscriptions table. Returns what happened so
 * the route can log it. Unknown events are ignored.
 */
export async function handlePaddleEvent(
  db: Database,
  event: PaddleSubscriptionEvent,
  prices: Record<string, string | undefined>,
): Promise<string> {
  if (!event.event_type?.startsWith('subscription.')) return `ignored ${event.event_type}`;
  const { data } = event;
  const userId = data.custom_data?.user_id;
  if (!userId) return 'ignored: no custom_data.user_id';
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) return `ignored: unknown user ${userId}`;
  const plan = planForPrice(data.items?.[0]?.price?.id, prices);
  if (!plan) return `ignored: unknown price ${data.items?.[0]?.price?.id}`;

  const values = {
    userId,
    planId: plan.id,
    status: data.status,
    paddleSubscriptionId: data.id,
    paddleCustomerId: data.customer_id ?? null,
    currentPeriodEnd: data.current_billing_period?.ends_at
      ? new Date(data.current_billing_period.ends_at)
      : null,
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
  return `${event.event_type}: ${userId} -> ${plan.id} (${data.status})`;
}
