/**
 * Strict IPv4/IPv6 parsing, canonical formatting (RFC 5952) and the reserved-range check.
 * Every validator, list and lookup in the API goes through parseIp(), so both versions are
 * always handled the same way.
 */

export type ParsedIp =
  | { readonly version: 4; readonly text: string; readonly value: number }
  | { readonly version: 6; readonly text: string; readonly value: bigint };

const MAX_TEXT_LENGTH = 45; // ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255

/** Parses an IPv4 or IPv6 address. IPv4-mapped IPv6 (::ffff:a.b.c.d) is returned as IPv4. */
export function parseIp(input: string): ParsedIp | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_TEXT_LENGTH) {
    return null;
  }
  if (!input.includes(':')) {
    const v4 = parseIpv4(input);
    return v4 === null ? null : { version: 4, text: input, value: v4 };
  }
  const groups = parseIpv6Groups(input);
  if (groups === null) return null;
  // IPv4-mapped: ::ffff:0:0/96
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    const value = (groups[6]! * 0x10000 + groups[7]!) >>> 0;
    return { version: 4, text: ipv4ToString(value), value };
  }
  return { version: 6, text: ipv6GroupsToString(groups), value: ipv6GroupsToBigInt(groups) };
}

/** Dotted-quad IPv4 without leading zeros (which some parsers read as octal). */
export function parseIpv4(input: string): number | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

export function ipv4ToString(value: number): string {
  return `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

/** Returns the eight 16-bit groups of an IPv6 address, or null if it is not valid. */
function parseIpv6Groups(input: string): number[] | null {
  if (!/^[0-9A-Fa-f:.]+$/.test(input)) return null; // rejects zone ids ("%eth0"), brackets, spaces
  const halves = input.split('::');
  if (halves.length > 2) return null;

  const parseSide = (side: string, allowTrailingIpv4: boolean): number[] | null => {
    if (side === '') return [];
    const parts = side.split(':');
    const groups: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part.includes('.')) {
        if (!allowTrailingIpv4 || i !== parts.length - 1) return null;
        const v4 = parseIpv4(part);
        if (v4 === null) return null;
        groups.push(v4 >>> 16, v4 & 0xffff);
      } else {
        if (!/^[0-9A-Fa-f]{1,4}$/.test(part)) return null;
        groups.push(parseInt(part, 16));
      }
    }
    return groups;
  };

  if (halves.length === 1) {
    const groups = parseSide(input, true);
    return groups !== null && groups.length === 8 ? groups : null;
  }
  const head = parseSide(halves[0]!, false);
  const tail = parseSide(halves[1]!, true);
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null; // "::" must stand for at least one group
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function ipv6GroupsToBigInt(groups: number[]): bigint {
  let hex = '';
  for (const group of groups) hex += group.toString(16).padStart(4, '0');
  return BigInt(`0x${hex}`);
}

/** RFC 5952 text form: lowercase, no leading zeros, longest zero run (>= 2 groups) as "::". */
function ipv6GroupsToString(groups: number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLength < 2) return hex.join(':');
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

export function bigIntToIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) groups.push(Number((value >> shift) & 0xffffn));
  return ipv6GroupsToString(groups);
}

// ---------------------------------------------------------------------------------------------
// Reserved ranges (IANA special-purpose address registries)
// ---------------------------------------------------------------------------------------------

const RESERVED_V4: readonly (readonly [network: number, length: number])[] = [
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // private
  '100.64.0.0/10', // shared address space (CGNAT)
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local
  '172.16.0.0/12', // private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // documentation (TEST-NET-1)
  '192.88.99.0/24', // deprecated 6to4 relay anycast
  '192.168.0.0/16', // private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // documentation (TEST-NET-2)
  '203.0.113.0/24', // documentation (TEST-NET-3)
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved for future use, includes 255.255.255.255
].map((cidr) => {
  const [addr, len] = cidr.split('/');
  return [parseIpv4(addr!)!, Number(len)] as const;
});

const V6_2001 = 0x2001n << 112n;
const V6_DOCUMENTATION = (0x2001n << 112n) | (0x0db8n << 96n);
const V6_DOCUMENTATION_2 = 0x3fffn << 112n;

function inV6Prefix(value: bigint, prefix: bigint, length: number): boolean {
  const shift = BigInt(128 - length);
  return value >> shift === prefix >> shift;
}

/**
 * True for addresses that are not globally routable: private, loopback, link-local, multicast,
 * documentation, benchmarking, CGNAT and other special-purpose ranges. For IPv6 everything
 * outside global unicast 2000::/3 counts as reserved. 6to4 (2002::/16) and Teredo (2001::/32)
 * are looked up normally because the databases map them to the embedded IPv4 address.
 */
export function isReserved(ip: ParsedIp): boolean {
  if (ip.version === 4) {
    const value = ip.value;
    for (const [network, length] of RESERVED_V4) {
      if (value >>> (32 - length) === network >>> (32 - length)) return true;
    }
    return false;
  }
  const value = ip.value;
  if (value >> 125n !== 1n) return true; // outside 2000::/3
  if (inV6Prefix(value, V6_2001, 23) && !inV6Prefix(value, V6_2001, 32)) return true;
  if (inV6Prefix(value, V6_DOCUMENTATION, 32)) return true;
  if (inV6Prefix(value, V6_DOCUMENTATION_2, 20)) return true;
  return false;
}

export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const ip = parseIp(address);
  if (!ip) return false;
  return ip.version === 4 ? ip.value >>> 24 === 127 : ip.value === 1n;
}
