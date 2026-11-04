import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lowercased and trimmed. */
  email: text('email').notNull().unique(),
  /** scrypt$N$r$p$salt$hash (see apps/web/src/server/password.ts). */
  passwordHash: text('password_hash').notNull(),
  /** Null until the user enters the emailed code (only required when RESEND_API_KEY is set). */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** sha256 of the session token; the token itself only lives in the user's cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** One pending email verification code (OTP) per user. */
export const emailVerificationCodes = pgTable('email_verification_codes', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  monthlyQuota: integer('monthly_quota').notNull(),
  /** Monthly price in US cents; null until pricing is decided. */
  priceCents: integer('price_cents'),
  sortOrder: integer('sort_order').notNull(),
});

/** Paid plan of a user. Users without a row are on the free plan. */
export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id),
  /** Paddle status: active, trialing, past_due, paused, canceled. */
  status: text('status').notNull(),
  paddleSubscriptionId: text('paddle_subscription_id').unique(),
  paddleCustomerId: text('paddle_customer_id'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** First characters of the key, shown in the dashboard ("ipx_AbC12345"). */
    prefix: text('prefix').notNull(),
    /** sha256 of the full key; the key itself is shown once and never stored. */
    keyHash: text('key_hash').notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

export const usageDaily = pgTable(
  'usage_daily',
  {
    keyId: uuid('key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    /** UTC day, YYYY-MM-DD. */
    date: date('date', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.date] })],
);
