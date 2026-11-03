import type { TimeZone } from '@ipx/shared';
import { find, preCache } from 'geo-tz/all';
import { Lru } from '../lru.ts';

/**
 * Coordinates → IANA zone via geo-tz's comprehensive dataset (one zone per country, e.g.
 * Asia/Karachi). DB-IP returns a limited set of city coordinates, so results are memoized.
 */
const zoneByCoordinates = new Lru<string, string | null>(200_000);

/** Loads all timezone polygons into memory so lookups never block on disk reads. */
export function preloadTimezones(): void {
  preCache();
}

export function timezoneAt(latitude: number, longitude: number): string | null {
  const key = `${latitude},${longitude}`;
  const cached = zoneByCoordinates.get(key);
  if (cached !== undefined) return cached;
  let zone: string | null;
  try {
    zone = find(latitude, longitude)[0] ?? null;
  } catch {
    zone = null; // out-of-range coordinates
  }
  zoneByCoordinates.set(key, zone);
  return zone;
}

// ---------------------------------------------------------------------------------------------
// Current offset / DST, computed at request time with the runtime's tz database (Intl)
// ---------------------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | null>();
const offsetCache = new Map<
  string,
  { offset: number; isDst: boolean; validFrom: number; validUntil: number }
>();
const standardOffsetCache = new Map<
  string,
  { year: number; standard: number; seasonal: boolean }
>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    } catch {
      formatter = null; // zone unknown to this runtime
    }
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** UTC offset of `zone` at `epochMs`, in seconds ("GMT-08:00" -> -28800). */
function offsetAt(formatter: Intl.DateTimeFormat, epochMs: number): number {
  const name = formatter.formatToParts(epochMs).find((p) => p.type === 'timeZoneName')?.value;
  const match = name ? /^GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name) : null;
  if (!match) return 0; // "GMT"
  const seconds = Number(match[2]) * 3600 + Number(match[3] ?? 0) * 60;
  return match[1] === '-' ? -seconds : seconds;
}

function standardOffset(zone: string, formatter: Intl.DateTimeFormat, epochMs: number) {
  const year = new Date(epochMs).getUTCFullYear();
  const cached = standardOffsetCache.get(zone);
  if (cached?.year === year) return cached;
  const january = offsetAt(formatter, Date.UTC(year, 0, 1));
  const july = offsetAt(formatter, Date.UTC(year, 6, 1));
  const entry = { year, standard: Math.min(january, july), seasonal: january !== july };
  standardOffsetCache.set(zone, entry);
  return entry;
}

export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const hours = String(Math.floor(abs / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

export const EMPTY_TIMEZONE: Readonly<TimeZone> = Object.freeze({
  id: null,
  utc_offset: null,
  utc_offset_seconds: null,
  is_dst: null,
  current_time: null,
});

/** Current offset, DST flag and local time for an IANA zone. Unknown zones yield null fields. */
export function timezoneInfo(zone: string | null, now: number = Date.now()): TimeZone {
  if (!zone) return { ...EMPTY_TIMEZONE };
  const formatter = formatterFor(zone);
  if (!formatter) return { ...EMPTY_TIMEZONE, id: zone };

  let entry = offsetCache.get(zone);
  if (!entry || now < entry.validFrom || now >= entry.validUntil) {
    const offset = offsetAt(formatter, now);
    const { standard, seasonal } = standardOffset(zone, formatter, now);
    // Offsets only change on the minute, so one computation serves the whole minute.
    const validFrom = now - (now % 60_000);
    entry = {
      offset,
      isDst: seasonal && offset > standard,
      validFrom,
      validUntil: validFrom + 60_000,
    };
    offsetCache.set(zone, entry);
  }
  const local = new Date(now + entry.offset * 1000).toISOString().slice(0, 19);
  const utcOffset = formatOffset(entry.offset);
  return {
    id: zone,
    utc_offset: utcOffset,
    utc_offset_seconds: entry.offset,
    is_dst: entry.isDst,
    current_time: `${local}${utcOffset}`,
  };
}
