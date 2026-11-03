import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import { bigIntToIpv6, isLoopback, isReserved, parseIp } from '../src/ip.ts';

function parse(text: string) {
  const ip = parseIp(text);
  if (!ip) throw new Error(`expected ${text} to parse`);
  return ip;
}

describe('parseIp', () => {
  it.each([
    ['8.8.8.8', 4, '8.8.8.8'],
    ['0.0.0.0', 4, '0.0.0.0'],
    ['255.255.255.255', 4, '255.255.255.255'],
    ['2001:4860:4860::8888', 6, '2001:4860:4860::8888'],
    ['2001:4860:4860:0000:0000:0000:0000:8888', 6, '2001:4860:4860::8888'],
    ['2001:DB8::1', 6, '2001:db8::1'],
    ['::1', 6, '::1'],
    ['::', 6, '::'],
    ['2001:db8:0:0:1:0:0:1', 6, '2001:db8::1:0:0:1'], // first longest zero run wins
    ['2001:db8:0:1:1:1:1:1', 6, '2001:db8:0:1:1:1:1:1'], // a single zero group is not compressed
    ['64:ff9b::192.0.2.33', 6, '64:ff9b::c000:221'],
    ['::ffff:8.8.8.8', 4, '8.8.8.8'], // IPv4-mapped IPv6 becomes IPv4
    ['::ffff:808:808', 4, '8.8.8.8'],
  ])('parses %s', (text, version, canonical) => {
    const ip = parse(text);
    expect(ip.version).toBe(version);
    expect(ip.text).toBe(canonical);
  });

  it.each([
    '',
    'abc',
    'not-an-ip',
    '1.2.3',
    '1.2.3.4.5',
    '256.1.1.1',
    '01.2.3.4', // leading zero (octal ambiguity)
    '1.2.3.-1',
    ' 1.2.3.4',
    '1.2.3.4 ',
    '1:2:3:4:5:6:7:8:9',
    '1::2::3',
    ':::',
    '12345::1',
    'fe80::1%eth0', // zone ids are not accepted
    '[::1]',
    '::1.2.3',
    '1.2.3.4::',
    'g::1',
    '1:2:3:4:5:6:7::8', // "::" must stand for at least one group
    'x'.repeat(100),
  ])('rejects %j', (text) => {
    expect(parseIp(text)).toBeNull();
  });

  it('agrees with node:net on random addresses', () => {
    for (let i = 0; i < 2000; i++) {
      const groups = Array.from({ length: 8 }, () =>
        Math.random() < 0.3 ? 0 : Math.floor(Math.random() * 0x10000),
      );
      const text = groups.map((g) => g.toString(16)).join(':');
      const ip = parse(text);
      expect(isIP(ip.text)).toBe(ip.version);
      if (ip.version === 6) expect(bigIntToIpv6(ip.value)).toBe(ip.text);
    }
  });
});

describe('isReserved', () => {
  it.each([
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.10.10',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '2001:db8::1',
    '3fff::1',
    '64:ff9b::808:808',
    '100::1',
    '2001:2::1',
  ])('%s is reserved', (text) => {
    expect(isReserved(parse(text))).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '100.128.0.1',
    '39.32.0.1',
    '2001:4860:4860::8888',
    '2a02:2028::1',
    '2002:808:808::1', // 6to4, mapped to the embedded IPv4 by the databases
    '2001::1', // Teredo
  ])('%s is public', (text) => {
    expect(isReserved(parse(text))).toBe(false);
  });
});

describe('isLoopback', () => {
  it('detects IPv4, IPv6 and IPv4-mapped loopback', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('127.1.2.3')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});
