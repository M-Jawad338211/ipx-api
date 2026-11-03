import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ApiError, IP_LOOKUP_LEAF_FIELDS, IpLookup } from '@ipx/shared';
import { Check, Errors } from 'typebox/value';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES, assertDataPresent, createTestApp } from './helpers.ts';

type Json = Record<string, unknown>;

let app: FastifyInstance;

beforeAll(async () => {
  assertDataPresent();
  // Real databases from data/, Tor exits from the checked-in fixture.
  app = await createTestApp({ files: { tor: path.join(FIXTURES, 'tor-exits.json') } });
});

afterAll(async () => {
  await app?.close();
});

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: 'GET', url, headers });
  return {
    status: res.statusCode,
    headers: res.headers,
    text: res.body,
    json: () => res.json<Json>(),
  };
}

function at(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((value, key) => (value as Json | null)?.[key], obj);
}

function expectSchema(body: unknown, schema: typeof IpLookup | typeof ApiError = IpLookup) {
  const valid = Check(schema, body);
  if (!valid) throw new Error(JSON.stringify([...Errors(schema, body)].slice(0, 5), null, 2));
}

/**
 * One assertion per response field for 8.8.8.8. The completeness test below fails when a field
 * is added to the schema without adding it here ("every field has a test").
 */
const FIELD_CHECKS: Record<string, (value: unknown, body: Json) => void> = {
  success: (v) => expect(v).toBe(true),
  ip: (v) => expect(v).toBe('8.8.8.8'),
  type: (v) => expect(v).toBe('ipv4'),
  reserved: (v) => expect(v).toBe(false),
  'location.continent': (v) => expect(v).toBe('North America'),
  'location.continent_code': (v) => expect(v).toBe('NA'),
  'location.country': (v) => expect(v).toBe('United States'),
  'location.country_code': (v) => expect(v).toBe('US'),
  'location.is_eu': (v) => expect(v).toBe(false),
  'location.region': (v) => expect(v).toEqual(expect.stringMatching(/\S/)),
  'location.city': (v) => expect(v).toEqual(expect.stringMatching(/\S/)),
  'location.postal': (v) => expect(v).toBeNull(),
  'location.latitude': (v) => expect(v).toEqual(expect.any(Number)),
  'location.longitude': (v) => expect(v).toEqual(expect.any(Number)),
  'timezone.id': (v) => expect(v).toEqual(expect.stringMatching(/^America\//)),
  'timezone.utc_offset': (v) => expect(v).toEqual(expect.stringMatching(/^-0[4-8]:00$/)),
  'timezone.utc_offset_seconds': (v, body) => {
    const [, sign, hours, minutes] = /^([+-])(\d{2}):(\d{2})$/.exec(
      at(body, 'timezone.utc_offset') as string,
    )!;
    expect(v).toBe((sign === '-' ? -1 : 1) * (Number(hours) * 3600 + Number(minutes) * 60));
  },
  'timezone.is_dst': (v) => expect(typeof v).toBe('boolean'),
  'timezone.current_time': (v, body) => {
    expect(v).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/),
    );
    expect((v as string).endsWith(at(body, 'timezone.utc_offset') as string)).toBe(true);
  },
  'network.asn': (v) => expect(v).toBe(15169),
  'network.as_name': (v) => expect(v).toBe('Google LLC'),
  'network.as_domain': (v) => expect(v).toBe('google.com'),
  'locale.flag': (v) => expect(v).toBe('🇺🇸'),
  'locale.calling_code': (v) => expect(v).toBe('+1'),
  'locale.currency.code': (v) => expect(v).toBe('USD'),
  'locale.currency.name': (v) => expect(v).toBe('United States dollar'),
  'locale.currency.symbol': (v) => expect(v).toBe('$'),
  'locale.languages': (v) => expect(v).toEqual([{ code: 'eng', name: 'English' }]),
  'security.is_tor': (v) => expect(v).toBe(false),
  'security.is_proxy': (v) => expect(v).toBe(false),
  'security.is_vpn': (v) => expect(v).toBe(false),
  'security.is_hosting': (v) => expect(v).toBe(true),
  'security.hosting_provider': (v) => expect(v).toBe('Google'),
  'security.source': (v) => expect(v).toBe('basic'),
};

describe('GET /json/8.8.8.8', () => {
  it('returns the full documented response', async () => {
    const res = await get('/json/8.8.8.8');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const body = res.json();
    expectSchema(body);
    for (const [field, check] of Object.entries(FIELD_CHECKS)) {
      try {
        check(at(body, field), body);
      } catch (error) {
        throw new Error(`field ${field}: ${(error as Error).message}`, { cause: error });
      }
    }
  });

  it('has a check for every field in the schema', () => {
    expect(Object.keys(FIELD_CHECKS).sort()).toEqual([...IP_LOOKUP_LEAF_FIELDS].sort());
  });

  it('serves the same result under /v1 and the unprefixed alias, with or without a trailing slash', async () => {
    const [a, b, c] = await Promise.all([
      get('/v1/json/8.8.8.8'),
      get('/json/8.8.8.8'),
      get('/v1/json/8.8.8.8/'),
    ]);
    const strip = (body: Json) => ({
      ...body,
      timezone: { ...(body.timezone as Json), current_time: null },
    });
    expect(strip(a.json())).toEqual(strip(b.json()));
    expect(strip(c.json())).toEqual(strip(b.json()));
  });
});

describe('IPv6', () => {
  it('looks up 2001:4860:4860::8888', async () => {
    const res = await get('/v1/json/2001:4860:4860::8888');
    expect(res.status).toBe(200);
    const body = res.json();
    expectSchema(body);
    expect(body).toMatchObject({
      ip: '2001:4860:4860::8888',
      type: 'ipv6',
      reserved: false,
      location: { country_code: 'US', continent_code: 'NA' },
      network: { asn: 15169, as_name: 'Google LLC' },
      locale: { currency: { code: 'USD' }, calling_code: '+1' },
    });
  });

  it('normalizes the address (expanded, uppercase, URL-encoded)', async () => {
    const body = (await get('/json/2001%3A4860%3A4860%3A0%3A0%3A0%3A0%3A8888')).json();
    expect(body.ip).toBe('2001:4860:4860::8888');
    expect((await get(`/json/${'2001:4860:4860::8888'.toUpperCase()}`)).json().ip).toBe(
      '2001:4860:4860::8888',
    );
  });

  it('treats IPv4-mapped IPv6 as IPv4', async () => {
    const body = (await get('/json/::ffff:8.8.8.8')).json();
    expect(body).toMatchObject({ ip: '8.8.8.8', type: 'ipv4', network: { asn: 15169 } });
  });

  it('never mixes countries: DB-IP city data is dropped when it disagrees with IPinfo', async () => {
    // For this address IPinfo says US while DB-IP City Lite says Montreal, CA.
    const body = (await get('/json/2001:4860:4860::8888')).json();
    const location = body.location as Json;
    expect(location.country_code).toBe('US');
    if (location.city !== null) expect(location.country).toBe('United States');
  });
});

describe('reserved addresses', () => {
  it.each([
    '10.0.0.1',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.1.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
  ])('%s returns 200 with reserved: true', async (address) => {
    const res = await get(`/json/${address}`);
    expect(res.status).toBe(200);
    const body = res.json();
    expectSchema(body);
    expect(body).toMatchObject({
      success: true,
      reserved: true,
      location: { country: null, city: null },
      network: { asn: null },
      security: { is_tor: false, is_hosting: false, source: 'basic' },
    });
  });
});

describe('invalid input', () => {
  it.each([
    'abc',
    'not-an-ip',
    '256.1.1.1',
    '1.2.3',
    '01.2.3.4',
    '1.2.3.4.5',
    '::1::',
    '1.2.3.4%20',
    '%3Cscript%3E',
    'fe80::1%25eth0',
    '%E0%A4%A', // malformed percent-encoding (rejected by the router)
    'a'.repeat(300), // longer than the router's max param length
  ])('%s -> 400 invalid_ip', async (garbage) => {
    const res = await get(`/json/${garbage}`);
    expect(res.status).toBe(400);
    const body = res.json();
    expectSchema(body, ApiError);
    expect(body).toMatchObject({ success: false, error: { code: 'invalid_ip' } });
  });

  it('answers unknown routes with not_found', async () => {
    const res = await get('/nope');
    expect(res.status).toBe(404);
    expect(res.json()).toEqual({
      success: false,
      error: { code: 'not_found', message: 'Route GET /nope not found' },
    });
  });
});

describe('fields=', () => {
  it('returns only the selected fields (plus success)', async () => {
    const res = await get(
      '/json/8.8.8.8?fields=ip,location.country_code,security.is_hosting,network',
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.json()).toEqual({
      success: true,
      ip: '8.8.8.8',
      location: { country_code: 'US' },
      network: { asn: 15169, as_name: 'Google LLC', as_domain: 'google.com' },
      security: { is_hosting: true },
    });
  });

  it('supports nested objects', async () => {
    const body = (await get('/json/8.8.8.8?fields=locale.currency.code')).json();
    expect(body).toEqual({ success: true, locale: { currency: { code: 'USD' } } });
  });

  it('rejects unknown fields with invalid_request', async () => {
    const res = await get('/json/8.8.8.8?fields=ip,country');
    expect(res.status).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });
});

describe('lang=', () => {
  it('localizes country and continent names', async () => {
    const body = (await get('/json/8.8.8.8?lang=de&fields=location')).json();
    expect(body.location).toMatchObject({
      country: 'Vereinigte Staaten von Amerika',
      continent: 'Nordamerika',
    });
  });

  it('matches a language by its base code (pt -> pt-BR, zh -> zh-CN) and ignores case', async () => {
    expect((await get('/json/8.8.8.8?lang=pt&fields=location.country')).json()).toMatchObject({
      location: { country: 'Estados Unidos' },
    });
    expect((await get('/json/8.8.8.8?lang=ZH-cn&fields=location.country')).json()).toMatchObject({
      location: { country: '美国' },
    });
  });

  it('cleans DB-IP name quirks (Spanish article suffix)', async () => {
    const body = (await get('/json/8.8.8.8?lang=es&fields=location.country')).json();
    expect(body).toMatchObject({ location: { country: 'Estados Unidos de América' } });
  });

  it('falls back to English for unknown languages and keeps cities in English', async () => {
    const english = (await get('/json/8.8.8.8?fields=location')).json();
    const unknown = (await get('/json/8.8.8.8?lang=xx-YY&fields=location')).json();
    const german = (await get('/json/8.8.8.8?lang=de&fields=location')).json();
    expect(unknown).toEqual(english);
    expect((german.location as Json).city).toBe((english.location as Json).city);
  });
});

describe('callback= (JSONP)', () => {
  it('wraps the response', async () => {
    const res = await get('/json/8.8.8.8?callback=handle&fields=ip');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.text).toBe(
      `/**/ typeof handle === 'function' && handle({"success":true,"ip":"8.8.8.8"});`,
    );
  });

  it('passes errors to the callback with HTTP 200', async () => {
    const res = await get('/json/garbage?callback=handle');
    expect(res.status).toBe(200);
    expect(res.text).toContain('handle({"success":false,"error":{"code":"invalid_ip"');
  });

  it('rejects unsafe callback names', async () => {
    const res = await get('/json/8.8.8.8?callback=alert(document.cookie)');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });
});

describe('security lists', () => {
  it('flags a Tor exit from the checked-in fixture list', async () => {
    const body = (await get('/json/185.220.101.1?fields=security')).json();
    expect(body).toEqual({
      success: true,
      security: {
        is_tor: true,
        is_proxy: false,
        is_vpn: false,
        is_hosting: false,
        hosting_provider: null,
        source: 'basic',
      },
    });
  });

  it('prefers the more specific cloud list over the general Google list', async () => {
    const body = (await get('/json/34.35.0.1?fields=security.hosting_provider')).json();
    expect(body).toEqual({ success: true, security: { hosting_provider: 'Google Cloud' } });
  });

  it('detects AWS ranges', async () => {
    const body = (
      await get('/json/3.5.140.1?fields=security.is_hosting,security.hosting_provider')
    ).json();
    expect(body).toEqual({
      success: true,
      security: { is_hosting: true, hosting_provider: 'AWS' },
    });
  });
});

describe.runIf(process.env.RUN_LIVE_TESTS === '1')('live Tor exit list', () => {
  it('flags an address taken from check.torproject.org right now', async () => {
    const text = await (await fetch('https://check.torproject.org/exit-addresses')).text();
    const address = /^ExitAddress\s+(\S+)/m.exec(text)?.[1];
    expect(address).toBeDefined();
    const dir = await mkdtemp(path.join(tmpdir(), 'ipx-tor-'));
    const file = path.join(dir, 'tor-exits.json');
    await writeFile(
      file,
      JSON.stringify({ fetched_at: new Date().toISOString(), addresses: [address] }),
    );
    const liveApp = await createTestApp({ files: { tor: file } });
    try {
      const res = await liveApp.inject(`/json/${address}?fields=security.is_tor`);
      expect(res.json()).toEqual({ success: true, security: { is_tor: true } });
    } finally {
      await liveApp.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('caller IP (GET /json)', () => {
  it('uses the socket address and is not cacheable', async () => {
    const res = await get('/json?fields=ip,reserved');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ success: true, ip: '127.0.0.1', reserved: true });
  });

  it('ignores proxy headers unless TRUSTED_PROXY=cloudflare', async () => {
    const res = await get('/json?fields=ip', {
      'cf-connecting-ip': '8.8.8.8',
      'x-forwarded-for': '1.1.1.1',
    });
    expect(res.json()).toEqual({ success: true, ip: '127.0.0.1' });
  });

  it('trusts CF-Connecting-IP, then the last X-Forwarded-For hop, behind Cloudflare', async () => {
    const cfApp = await createTestApp({ env: { TRUSTED_PROXY: 'cloudflare' } });
    try {
      const cf = await cfApp.inject({
        url: '/json?fields=ip',
        headers: { 'cf-connecting-ip': '8.8.8.8' },
      });
      expect(cf.json()).toEqual({ success: true, ip: '8.8.8.8' });
      const xff = await cfApp.inject({
        url: '/json?fields=ip',
        headers: { 'x-forwarded-for': '6.6.6.6, 2001:4860:4860::8888' },
      });
      expect(xff.json()).toEqual({ success: true, ip: '2001:4860:4860::8888' });
    } finally {
      await cfApp.close();
    }
  });
});

describe('GET /health', () => {
  it('reports loaded databases and lists', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'ok',
      databases: {
        city: { loaded: true, file: 'dbip-city-lite.mmdb', database_type: 'DBIP-City-Lite' },
        asn: { loaded: true, file: 'ipinfo_lite.mmdb' },
      },
      lists: { tor: { loaded: true, entries: 3 } },
    });
    expect(at(body, 'databases.city.age_days')).toEqual(expect.any(Number));
    expect(body.countries).toBeGreaterThan(240);
  });
});

describe('POST /internal/reload', () => {
  it('reloads from a local process', async () => {
    const res = await app.inject({ method: 'POST', url: '/internal/reload' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      reloaded: ['city', 'asn', 'tor', 'hosting'],
    });
  });

  it('is invisible to proxied or remote requests', async () => {
    const proxied = await app.inject({
      method: 'POST',
      url: '/internal/reload',
      headers: { 'x-forwarded-for': '203.0.113.5' },
    });
    expect(proxied.statusCode).toBe(404);
    const remote = await app.inject({
      method: 'POST',
      url: '/internal/reload',
      remoteAddress: '8.8.8.8',
    });
    expect(remote.statusCode).toBe(404);
    expect(remote.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('without data', () => {
  it('answers lookups with 503 service_unavailable and health with degraded', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ipx-empty-'));
    const empty = await createTestApp({ dataDir: dir });
    try {
      const lookup = await empty.inject('/json/8.8.8.8');
      expect(lookup.statusCode).toBe(503);
      expect(lookup.json()).toMatchObject({ error: { code: 'service_unavailable' } });
      const health = await empty.inject('/health');
      expect(health.statusCode).toBe(503);
      expect(health.json()).toMatchObject({ status: 'degraded' });
    } finally {
      await empty.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
