import postgres from 'postgres';
import { migrateDatabase } from './migrate.ts';

/** Postgres server used by tests: the docker compose service unless TEST_DATABASE_SERVER is set. */
const SERVER = process.env.TEST_DATABASE_SERVER || 'postgres://ipx:ipx@localhost:5433';

/**
 * Creates (if needed), migrates and empties a test database, returning its URL. Each package
 * uses its own database name so test runs in parallel do not interfere.
 */
export async function prepareTestDatabase(name: string): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`invalid database name ${name}`);
  const admin = postgres(`${SERVER}/postgres`, { max: 1, onnotice: () => {} });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) await admin.unsafe(`create database ${name}`);
  } catch (error) {
    throw new Error(
      `Cannot reach the test Postgres at ${SERVER} (${(error as Error).message}). Start it with: docker compose up -d postgres`,
      { cause: error },
    );
  } finally {
    await admin.end({ timeout: 5 });
  }
  const url = `${SERVER}/${name}`;
  await migrateDatabase(url);
  const db = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(
      'truncate table corrections, usage_daily, api_keys, subscriptions, email_verification_codes, sessions, users cascade',
    );
  } finally {
    await db.end({ timeout: 5 });
  }
  return url;
}
