/**
 * Writes accepted corrections from Postgres to data/location-overrides.json (atomically) and
 * asks the API to reload when the content changed. Run every few minutes next to the API.
 * Usage: node scripts/export-corrections.ts   (reads DATABASE_URL)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOverrides, createDb } from '@ipx/db';
import { DATA_DIR, alert, log, notifyReload, writeFileAtomic } from './lib/common.ts';

const FILE = path.join(DATA_DIR, 'location-overrides.json');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, close } = createDb(url, { max: 1 });
  try {
    const next = await buildOverrides(db);
    const previous = await readFile(FILE, 'utf8')
      .then((text) => (JSON.parse(text) as { overrides?: unknown }).overrides)
      .catch(() => undefined);
    if (JSON.stringify(previous) === JSON.stringify(next.overrides)) {
      log(`corrections: ${next.overrides.length} accepted, unchanged`);
      return;
    }
    await writeFileAtomic(FILE, `${JSON.stringify(next, null, 2)}\n`);
    log(`corrections: wrote ${next.overrides.length} overrides to ${FILE}`);
    await notifyReload();
  } finally {
    await close();
  }
}

main().catch(async (error: unknown) => {
  console.error(error);
  await alert(`export-corrections failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
