import { parseIp, type ParsedIp } from '../ip.ts';

export interface ParsedCidr {
  version: 4 | 6;
  length: number;
  /** Network address with host bits cleared. */
  network: number | bigint;
}

export function parseCidr(cidr: string): ParsedCidr | null {
  const slash = cidr.indexOf('/');
  if (slash === -1) return null;
  const lengthText = cidr.slice(slash + 1);
  if (!/^\d{1,3}$/.test(lengthText)) return null;
  const length = Number(lengthText);
  const ip = parseIp(cidr.slice(0, slash));
  if (!ip) return null;
  if (ip.version === 4) {
    // An IPv4-mapped IPv6 prefix ("::ffff:1.2.3.0/120") is converted to its IPv4 form.
    const isMapped = cidr.includes(':');
    const v4Length = isMapped ? length - 96 : length;
    if (v4Length < 0 || v4Length > 32) return null;
    const network = v4Length === 0 ? 0 : ((ip.value >>> (32 - v4Length)) << (32 - v4Length)) >>> 0;
    return { version: 4, length: v4Length, network };
  }
  if (length > 128) return null;
  const shift = BigInt(128 - length);
  return { version: 6, length, network: (ip.value >> shift) << shift };
}

const V6_SHIFTS = Array.from({ length: 129 }, (_, length) => BigInt(128 - length));

/**
 * Longest-prefix-match set of CIDR ranges with a value per range. Ranges are bucketed by prefix
 * length (one hash map per length), so a lookup costs at most one map probe per distinct length.
 * Adding the same prefix twice keeps the last value.
 */
export class CidrMatcher<T> {
  readonly #v4 = new Map<number, Map<number, T>>();
  readonly #v6 = new Map<number, Map<bigint, T>>();
  #v4Lengths: number[] = [];
  #v6Lengths: number[] = [];
  #size = 0;

  /** Returns false when `cidr` is not a valid range. */
  add(cidr: string, value: T): boolean {
    const parsed = parseCidr(cidr);
    if (!parsed) return false;
    if (parsed.version === 4) {
      let bucket = this.#v4.get(parsed.length);
      if (!bucket) {
        bucket = new Map();
        this.#v4.set(parsed.length, bucket);
        this.#v4Lengths = [...this.#v4.keys()].sort((a, b) => b - a);
      }
      const key = parsed.length === 0 ? 0 : (parsed.network as number) >>> (32 - parsed.length);
      if (!bucket.has(key)) this.#size++;
      bucket.set(key, value);
    } else {
      let bucket = this.#v6.get(parsed.length);
      if (!bucket) {
        bucket = new Map();
        this.#v6.set(parsed.length, bucket);
        this.#v6Lengths = [...this.#v6.keys()].sort((a, b) => b - a);
      }
      const key = (parsed.network as bigint) >> V6_SHIFTS[parsed.length]!;
      if (!bucket.has(key)) this.#size++;
      bucket.set(key, value);
    }
    return true;
  }

  /** Value of the most specific range containing `ip`, if any. */
  match(ip: ParsedIp): T | undefined {
    if (ip.version === 4) {
      for (const length of this.#v4Lengths) {
        const key = length === 0 ? 0 : ip.value >>> (32 - length);
        const value = this.#v4.get(length)!.get(key);
        if (value !== undefined) return value;
      }
      return undefined;
    }
    for (const length of this.#v6Lengths) {
      const value = this.#v6.get(length)!.get(ip.value >> V6_SHIFTS[length]!);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  get size(): number {
    return this.#size;
  }
}
