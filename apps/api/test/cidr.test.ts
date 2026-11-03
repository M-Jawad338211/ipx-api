import { describe, expect, it } from 'vitest';
import { parseIp } from '../src/ip.ts';
import { CidrMatcher, parseCidr } from '../src/security/cidr.ts';

const ip = (text: string) => parseIp(text)!;

describe('CidrMatcher', () => {
  it('returns the most specific range (IPv4)', () => {
    const m = new CidrMatcher<string>();
    m.add('8.0.0.0/8', 'broad');
    m.add('8.8.8.0/24', 'specific');
    m.add('8.8.8.8/32', 'host');
    expect(m.match(ip('8.8.8.8'))).toBe('host');
    expect(m.match(ip('8.8.8.9'))).toBe('specific');
    expect(m.match(ip('8.1.1.1'))).toBe('broad');
    expect(m.match(ip('9.0.0.0'))).toBeUndefined();
  });

  it('returns the most specific range (IPv6)', () => {
    const m = new CidrMatcher<string>();
    m.add('2600:1f00::/24', 'broad');
    m.add('2600:1f14::/35', 'specific');
    m.add('2a05:d07a:a000::/40', 'other');
    expect(m.match(ip('2600:1f14::1'))).toBe('specific');
    expect(m.match(ip('2600:1f00::1'))).toBe('broad');
    expect(m.match(ip('2a05:d07a:a0ff::1'))).toBe('other');
    expect(m.match(ip('2a05:d07a:a100::1'))).toBeUndefined();
  });

  it('keeps IPv4 and IPv6 separate and handles /0, /32 and /128', () => {
    const m = new CidrMatcher<string>();
    m.add('0.0.0.0/0', 'any-v4');
    m.add('::1/128', 'loopback-v6');
    expect(m.match(ip('203.0.113.1'))).toBe('any-v4');
    expect(m.match(ip('::1'))).toBe('loopback-v6');
    expect(m.match(ip('::2'))).toBeUndefined();
  });

  it('lets a later add win for the same prefix and clears host bits', () => {
    const m = new CidrMatcher<string>();
    m.add('34.0.0.0/15', 'Google');
    m.add('34.1.2.3/15', 'Google Cloud'); // same network once host bits are cleared
    expect(m.size).toBe(1);
    expect(m.match(ip('34.1.255.255'))).toBe('Google Cloud');
  });

  it('rejects invalid ranges', () => {
    const m = new CidrMatcher<string>();
    for (const bad of ['1.2.3.4', '1.2.3.4/33', '::/129', 'abc/8', '1.2.3.4/-1', '1.2.3.4/x']) {
      expect(m.add(bad, 'x')).toBe(false);
    }
    expect(m.size).toBe(0);
  });

  it('converts IPv4-mapped IPv6 prefixes to IPv4', () => {
    expect(parseCidr('::ffff:10.0.0.0/104')).toEqual({
      version: 4,
      length: 8,
      network: 0x0a000000,
    });
  });
});
