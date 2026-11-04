import { asc, eq } from 'drizzle-orm';
import type { Database } from './client.ts';
import { corrections } from './schema.ts';

export interface OverridesFile {
  generated_at: string;
  overrides: {
    network: string;
    country_code: string;
    region: string | null;
    city: string | null;
  }[];
}

/**
 * Accepted corrections in review order, as the API's data/location-overrides.json. When two
 * corrections cover the same network, the later review wins (the API keeps the last entry).
 */
export async function buildOverrides(db: Database, now = new Date()): Promise<OverridesFile> {
  const rows = await db
    .select()
    .from(corrections)
    .where(eq(corrections.status, 'accepted'))
    .orderBy(asc(corrections.reviewedAt), asc(corrections.createdAt));
  return {
    generated_at: now.toISOString(),
    overrides: rows.map((r) => ({
      network: r.network ?? (r.ip.includes(':') ? `${r.ip}/128` : `${r.ip}/32`),
      country_code: r.countryCode,
      region: r.region,
      city: r.city,
    })),
  };
}
