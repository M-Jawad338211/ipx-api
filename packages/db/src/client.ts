import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
    // The connection is used from long-running servers; idle connections are recycled.
    idle_timeout: 60,
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}

export type Database = ReturnType<typeof createDb>['db'];
