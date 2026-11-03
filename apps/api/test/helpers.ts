import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { DEFAULT_DATA_DIR, loadConfig } from '../src/config.ts';
import { dataFilesIn, type DataFiles } from '../src/data/store.ts';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
export const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');

/** The lookup tests run against the real databases in data/. */
export function assertDataPresent(): void {
  const files = dataFilesIn(DATA_DIR);
  const missing = [files.city, files.asn].filter((f) => !existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')}. Run "pnpm update-db" (and "pnpm update-security") first.`,
    );
  }
}

export async function createTestApp(
  options: { env?: Record<string, string>; files?: Partial<DataFiles>; dataDir?: string } = {},
): Promise<FastifyInstance> {
  const config = loadConfig({
    LOG_LEVEL: 'silent',
    DATA_DIR: options.dataDir ?? DATA_DIR,
    DATA_REFRESH_SECONDS: '0',
    ...options.env,
  });
  const app = await buildApp({ config, logger: false, files: options.files });
  await app.store.refresh();
  await app.ready();
  return app;
}
