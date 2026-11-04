/** Location overrides (accepted corrections), health warnings, /metrics and request ids. */
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDataPresent, createTestApp } from './helpers.ts';

type Body = Record<string, Record<string, unknown>>;

let dir: string;
let overridesFile: string;
let app: FastifyInstance;

async function writeOverrides(overrides: unknown[]) {
  await writeFile(
    overridesFile,
    JSON.stringify({ generated_at: new Date().toISOString(), overrides }),
  );
  // Make sure the size/mtime signature changes even within the same millisecond.
  const later = new Date(Date.now() + Math.floor(Math.random() * 1000) + 1000);
  await utimes(overridesFile, later, later);
}

beforeAll(async () => {
  assertDataPresent();
  dir = await mkdtemp(path.join(tmpdir(), 'ipx-overrides-'));
  overridesFile = path.join(dir, 'location-overrides.json');
  app = await createTestApp({ files: { overrides: overridesFile } });
});

afterAll(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

describe('location overrides', () => {
  it('works without an overrides file', async () => {
    const body = (await app.inject('/json/8.8.8.8?fields=location.country_code')).json<Body>();
    expect(body.location).toEqual({ country_code: 'US' });
  });

  it('replaces the location of a corrected network and keeps network and security data', async () => {
    await writeOverrides([
      { network: '39.32.0.0/16', country_code: 'PK', region: 'Punjab', city: 'Lahore' },
      { network: '8.8.8.8/32', country_code: 'DE', region: 'Hesse', city: 'Frankfurt am Main' },
    ]);
    await app.store.refresh();

    const pk = (await app.inject('/json/39.32.0.1')).json<Body>();
    expect(pk.location).toMatchObject({
      country: 'Pakistan',
      country_code: 'PK',
      region: 'Punjab',
      city: 'Lahore',
      latitude: null, // the database had Islamabad: its coordinates no longer apply
    });
    expect(pk.timezone).toMatchObject({ id: 'Asia/Karachi' }); // single-zone country fallback
    expect(pk.network).toMatchObject({ asn: 17557 });

    const de = (await app.inject('/json/8.8.8.8')).json<Body>();
    expect(de.location).toMatchObject({
      continent: 'Europe',
      continent_code: 'EU',
      country: 'Germany',
      country_code: 'DE',
      is_eu: true,
      city: 'Frankfurt am Main',
    });
    expect(de.locale).toMatchObject({ currency: { code: 'EUR' }, calling_code: '+49' });
    expect(de.network).toMatchObject({ asn: 15169 });
    expect(de.security).toMatchObject({ is_hosting: true, hosting_provider: 'Google' });

    const localized = (
      await app.inject('/json/8.8.8.8?lang=fr&fields=location.country')
    ).json<Body>();
    expect(localized.location).toEqual({ country: 'Allemagne' });

    // Neighbouring addresses outside the corrected network are untouched.
    const neighbour = (await app.inject('/json/8.8.4.4?fields=location.country_code')).json<Body>();
    expect(neighbour.location).toEqual({ country_code: 'US' });
  });

  it('keeps the coordinates when the correction confirms the same city', async () => {
    await writeOverrides([
      {
        network: '39.32.0.0/16',
        country_code: 'PK',
        region: 'Islamabad Capital Territory',
        city: 'Islamabad',
      },
    ]);
    await app.store.refresh();
    const body = (await app.inject('/json/39.32.0.1')).json<Body>();
    expect(body.location).toMatchObject({
      region: 'Islamabad Capital Territory',
      city: 'Islamabad',
    });
    expect(body.location!.latitude).toEqual(expect.any(Number));
  });

  it('reports the overrides in /health and drops them when the file disappears', async () => {
    let health = (await app.inject('/health')).json<Body>();
    expect(health.lists!.overrides).toMatchObject({ loaded: true, entries: 1 });
    await rm(overridesFile);
    await app.store.refresh();
    health = (await app.inject('/health')).json<Body>();
    expect(health.lists!.overrides).toMatchObject({ loaded: false, entries: 0 });
    const body = (await app.inject('/json/39.32.0.1?fields=location.city')).json<Body>();
    expect(body.location).toEqual({ city: 'Islamabad' });
  });
});

describe('health warnings', () => {
  it('flags stale lists', async () => {
    const staleDir = await mkdtemp(path.join(tmpdir(), 'ipx-stale-'));
    const tor = path.join(staleDir, 'tor-exits.json');
    await writeFile(
      tor,
      JSON.stringify({
        fetched_at: new Date(Date.now() - 8 * 3_600_000).toISOString(),
        addresses: ['1.2.3.4'],
      }),
    );
    const staleApp = await createTestApp({
      files: { tor, hosting: path.join(staleDir, 'none.json') },
    });
    try {
      const health = (await staleApp.inject('/health')).json<{ warnings: string[] }>();
      expect(health.warnings).toEqual(['tor list is 8 hours old', 'hosting list is not loaded']);
    } finally {
      await staleApp.close();
      await rm(staleDir, { recursive: true, force: true });
    }
  });
});

describe('observability', () => {
  it('returns a request id, reusing a sane incoming one', async () => {
    const minted = await app.inject('/json/8.8.8.8');
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const reused = await app.inject({
      url: '/json/8.8.8.8',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(reused.headers['x-request-id']).toBe('abc-123');
    const unsafe = await app.inject({
      url: '/json/8.8.8.8',
      headers: { 'x-request-id': 'bad id\n' },
    });
    expect(unsafe.headers['x-request-id']).not.toBe('bad id\n');
  });

  it('serves Prometheus metrics to local processes only', async () => {
    await app.inject('/v1/json/1.1.1.1');
    await app.inject('/v1/json/garbage');
    const res = await app.inject('/metrics');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain; version=0.0.4');
    expect(res.body).toMatch(
      /ipx_http_requests_total\{method="GET",route="\/v1\/json\/:ip",status="200"\} \d+/,
    );
    expect(res.body).toMatch(
      /ipx_http_requests_total\{method="GET",route="\/v1\/json\/:ip",status="400"\} \d+/,
    );
    expect(res.body).toContain(
      'ipx_http_request_duration_seconds_bucket{route="/v1/json/:ip",le="+Inf"}',
    );
    expect(res.body).toMatch(/ipx_data_age_seconds\{source="city"\} \d+/);
    expect(res.body).toMatch(/ipx_process_resident_memory_bytes \d+/);

    const proxied = await app.inject({
      url: '/metrics',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(proxied.statusCode).toBe(404);
  });

  it('requires the bearer token when METRICS_TOKEN is set', async () => {
    const tokenApp = await createTestApp({ env: { METRICS_TOKEN: 's3cret' } });
    try {
      expect((await tokenApp.inject('/metrics')).statusCode).toBe(404);
      const ok = await tokenApp.inject({
        url: '/metrics',
        headers: { authorization: 'Bearer s3cret' },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await tokenApp.close();
    }
  });
});
