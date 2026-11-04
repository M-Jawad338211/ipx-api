/**
 * Generates a Postman collection (v2.1) from packages/shared/openapi.json into
 * packages/shared/postman_collection.json. With --check it only verifies the file is current.
 * Variables: baseUrl (from the first OpenAPI server) and apiKey (sent as a bearer token).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, writeFileAtomic } from './lib/common.ts';

const SPEC = path.join(REPO_ROOT, 'packages/shared/openapi.json');
const OUTPUT = path.join(REPO_ROOT, 'packages/shared/postman_collection.json');

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: { examples?: unknown[] };
}
interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  security?: Record<string, string[]>[];
  requestBody?: {
    content?: Record<
      string,
      { schema?: { properties?: Record<string, { examples?: unknown[] }> } }
    >;
  };
}
interface Spec {
  info: { title: string; description?: string; version: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, Operation>>;
}

function exampleBody(op: Operation): string | undefined {
  const props = op.requestBody?.content?.['application/json']?.schema?.properties;
  if (!props) return undefined;
  const body = Object.fromEntries(
    Object.entries(props).map(([k, v]) => [k, v.examples?.[0] ?? null]),
  );
  return JSON.stringify(body, null, 2);
}

export function toPostman(spec: Spec) {
  const folders = new Map<string, unknown[]>();
  for (const [route, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const pathParts = route
        .replace(/^\//, '')
        .split('/')
        .map((p) => p.replace(/^\{(.+)\}$/, ':$1'));
      const params = op.parameters ?? [];
      const needsKey = op.security?.length && !op.security.some((s) => Object.keys(s).length === 0);
      const body = exampleBody(op);
      const item = {
        name: op.summary ?? `${method.toUpperCase()} ${route}`,
        request: {
          method: method.toUpperCase(),
          description: op.description,
          header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
          // Keyed endpoints use the collection's bearer auth; others send no key by default.
          ...(needsKey || op.security?.length ? {} : { auth: { type: 'noauth' } }),
          url: {
            raw: `{{baseUrl}}/${pathParts.join('/')}`,
            host: ['{{baseUrl}}'],
            path: pathParts,
            query: params
              .filter((p) => p.in === 'query' && p.name !== 'key')
              .map((p) => ({
                key: p.name,
                value: '',
                description: p.description,
                disabled: !p.required,
              })),
            variable: params
              .filter((p) => p.in === 'path')
              .map((p) => ({
                key: p.name,
                value: typeof p.schema?.examples?.[0] === 'string' ? p.schema.examples[0] : '',
                description: p.description,
              })),
          },
          ...(body
            ? { body: { mode: 'raw', raw: body, options: { raw: { language: 'json' } } } }
            : {}),
        },
      };
      const tag = op.tags?.[0] ?? 'Other';
      folders.set(tag, [...(folders.get(tag) ?? []), item]);
    }
  }
  return {
    info: {
      name: spec.info.title,
      description: spec.info.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      version: spec.info.version,
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{apiKey}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: spec.servers?.[0]?.url ?? 'http://localhost:8080' },
      { key: 'apiKey', value: 'ipx_your_key' },
    ],
    item: [...folders].map(([name, item]) => ({ name, item })),
  };
}

async function main(): Promise<void> {
  const spec = JSON.parse(await readFile(SPEC, 'utf8')) as Spec;
  const output = `${JSON.stringify(toPostman(spec), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT, 'utf8').catch(() => '');
    if (current !== output) {
      console.error(`${OUTPUT} is out of date. Run: pnpm postman`);
      process.exit(1);
    }
    console.log('postman_collection.json is up to date');
    return;
  }
  await writeFileAtomic(OUTPUT, output);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
