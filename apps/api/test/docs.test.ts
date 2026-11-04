import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ERROR_CODES, IP_LOOKUP_FIELDS } from '@ipx/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

const REPO = path.resolve(import.meta.dirname, '../../..');
const docs = readFileSync(path.join(REPO, 'docs/response.md'), 'utf8');

/** Field names documented in a table row: | `location.city` | ... */
const documentedFields = new Set(
  [...docs.matchAll(/^\|\s*`([a-z_.]+)`\s*\|/gm)]
    .map((m) => m[1]!)
    .filter((name) => !name.includes('/')),
);

describe('docs/response.md', () => {
  it('documents every response field', () => {
    const missing = IP_LOOKUP_FIELDS.filter((field) => !documentedFields.has(field));
    expect(missing).toEqual([]);
  });

  it('does not document fields that do not exist', () => {
    const params = new Set(['fields', 'lang', 'callback', 'key']);
    const known = new Set([...IP_LOOKUP_FIELDS, ...ERROR_CODES, ...params]);
    expect([...documentedFields].filter((name) => !known.has(name))).toEqual([]);
  });

  it('documents every error code', () => {
    for (const code of ERROR_CODES) expect(documentedFields.has(code)).toBe(true);
  });
});

describe('packages/shared/openapi.json', () => {
  it('matches the spec generated from the routes (run pnpm openapi after schema changes)', async () => {
    const committed = readFileSync(path.join(REPO, 'packages/shared/openapi.json'), 'utf8');
    const app = await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent' }), logger: false });
    await app.ready();
    const generated = `${JSON.stringify(app.swagger(), null, 2)}\n`;
    await app.close();
    expect(committed).toBe(generated);
  });

  it('describes the v1 lookup routes and hides the aliases and internal routes', () => {
    const spec = JSON.parse(
      readFileSync(path.join(REPO, 'packages/shared/openapi.json'), 'utf8'),
    ) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/health',
      '/v1/batch',
      '/v1/json',
      '/v1/json/{ip}',
    ]);
  });
});
