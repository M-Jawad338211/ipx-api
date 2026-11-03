/**
 * Writes the OpenAPI 3.1 document generated from the route schemas to
 * packages/shared/openapi.json (consumed by the docs site and the SDK).
 * With --check it only verifies that the committed file is current (for CI).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const OUTPUT = path.resolve(import.meta.dirname, '../../../packages/shared/openapi.json');

const config = loadConfig({ ...process.env, LOG_LEVEL: 'silent' });
const app = await buildApp({ config, logger: false });
await app.ready();
const spec = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await app.close();

if (process.argv.includes('--check')) {
  const current = await readFile(OUTPUT, 'utf8').catch(() => '');
  if (current !== spec) {
    console.error(`${OUTPUT} is out of date. Run: pnpm openapi`);
    process.exit(1);
  }
  console.log('openapi.json is up to date');
} else {
  await writeFile(OUTPUT, spec);
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}`);
}
