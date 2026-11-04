export interface PlanDefinition {
  id: 'free' | 'starter' | 'pro' | 'business';
  name: string;
  /** Lookups per calendar month (UTC), shared by all keys of an account. */
  monthlyQuota: number;
  /** Monthly price in US cents; null until pricing is decided (shown as "Contact us"). */
  priceCents: number | null;
  sortOrder: number;
}

/** Plan catalogue. `pnpm --filter @ipx/db migrate` upserts these rows into the plans table. */
export const PLANS: readonly PlanDefinition[] = [
  { id: 'free', name: 'Free', monthlyQuota: 10_000, priceCents: 0, sortOrder: 0 },
  { id: 'starter', name: 'Starter', monthlyQuota: 100_000, priceCents: null, sortOrder: 1 },
  { id: 'pro', name: 'Pro', monthlyQuota: 1_000_000, priceCents: null, sortOrder: 2 },
  { id: 'business', name: 'Business', monthlyQuota: 5_000_000, priceCents: null, sortOrder: 3 },
];

export const FREE_PLAN = PLANS[0]!;

export function planById(id: string | null | undefined): PlanDefinition {
  return PLANS.find((p) => p.id === id) ?? FREE_PLAN;
}

/** Anonymous (no key) limits, per client IP. */
export const ANONYMOUS_LIMITS = { perMinute: 45, perDay: 1_000 } as const;

/** Paddle subscription statuses that grant the paid plan. */
export const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'trialing',
  'past_due',
]);
