/**
 * Applies the SQL migrations in packages/db/drizzle and upserts the plan catalogue.
 * Usage: pnpm db:migrate   (reads DATABASE_URL)
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.ts';
import { PLANS } from './plans.ts';
import { plans } from './schema.ts';

const MIGRATIONS = path.resolve(import.meta.dirname, '../drizzle');

export async function migrateDatabase(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS });
    for (const plan of PLANS) {
      await db
        .insert(plans)
        .values(plan)
        .onConflictDoUpdate({
          target: plans.id,
          set: {
            name: sql`excluded.name`,
            monthlyQuota: sql`excluded.monthly_quota`,
            priceCents: sql`excluded.price_cents`,
            sortOrder: sql`excluded.sort_order`,
          },
        });
    }
  } finally {
    await close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  await migrateDatabase(url);
  console.log('Database migrated and plans seeded');
}
