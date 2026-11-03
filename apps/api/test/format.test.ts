import { describe, expect, it } from 'vitest';
import { isValidCallback, jsonpBody, parseFields, pickFields } from '../src/http/format.ts';

describe('parseFields', () => {
  it('returns null when nothing is selected', () => {
    expect(parseFields(undefined)).toBeNull();
    expect(parseFields('')).toBeNull();
    expect(parseFields(' , ')).toBeNull();
  });

  it('accepts top-level, group and nested names, trimming and de-duplicating', () => {
    expect(parseFields(' ip, location ,location.city,locale.currency.code,ip')).toEqual([
      'ip',
      'location',
      'location.city',
      'locale.currency.code',
    ]);
  });

  it('rejects unknown names', () => {
    expect(() => parseFields('ip,country')).toThrow(/Unknown field in fields=: country/);
    expect(() => parseFields('foo,location.bar')).toThrow(/foo, location.bar/);
  });
});

describe('pickFields', () => {
  const result = {
    success: true,
    ip: '8.8.8.8',
    location: { country: 'United States', city: 'Mountain View' },
    locale: { currency: { code: 'USD', name: 'US dollar' }, languages: [{ code: 'eng' }] },
  };

  it('keeps success and the requested paths in schema order', () => {
    expect(pickFields(result, ['location.city', 'ip'])).toEqual({
      success: true,
      ip: '8.8.8.8',
      location: { city: 'Mountain View' },
    });
  });

  it('returns whole groups and nested objects', () => {
    expect(pickFields(result, ['location', 'locale.currency.code'])).toEqual({
      success: true,
      location: { country: 'United States', city: 'Mountain View' },
      locale: { currency: { code: 'USD' } },
    });
  });

  it('copies null branches as null', () => {
    const withNull = { ...result, locale: { currency: null, languages: [] } };
    expect(pickFields(withNull, ['locale.currency.code'])).toEqual({ success: true, locale: {} });
    expect(pickFields(withNull, ['locale.currency'])).toEqual({
      success: true,
      locale: { currency: null },
    });
  });
});

describe('JSONP', () => {
  it.each(['cb', 'jQuery123_456', '$', '_x', 'my.ns.handler', 'a'.repeat(64)])(
    'accepts callback %s',
    (name) => expect(isValidCallback(name)).toBe(true),
  );

  it.each(['', '1abc', 'alert(1)', 'a-b', 'a b', 'x;y', '<script>', 'a'.repeat(65), 'a[0]'])(
    'rejects callback %j',
    (name) => expect(isValidCallback(name)).toBe(false),
  );

  it('wraps the payload and escapes line separators', () => {
    const body = jsonpBody('cb', { text: 'a b c' });
    expect(body).toBe(`/**/ typeof cb === 'function' && cb({"text":"a\\u2028b\\u2029c"});`);
  });
});
