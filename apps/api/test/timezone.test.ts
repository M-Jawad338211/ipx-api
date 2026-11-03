import { describe, expect, it } from 'vitest';
import { formatOffset, timezoneAt, timezoneInfo } from '../src/enrich/timezone.ts';

const JAN = Date.UTC(2026, 0, 15, 12, 0, 0);
const JUL = Date.UTC(2026, 6, 15, 12, 0, 0);

describe('timezoneAt', () => {
  it.each([
    [37.422, -122.085, 'America/Los_Angeles'],
    [33.6844, 73.0479, 'Asia/Karachi'],
    [51.5143, -0.0912, 'Europe/London'],
    [-27.4767, 153.017, 'Australia/Brisbane'],
    [12.826174, 45.036933, 'Asia/Aden'], // comprehensive dataset: one zone per country
  ])('(%d, %d) -> %s', (lat, lon, zone) => {
    expect(timezoneAt(lat, lon)).toBe(zone);
  });

  it('returns null for impossible coordinates', () => {
    expect(timezoneAt(123, 456)).toBeNull();
  });
});

describe('timezoneInfo', () => {
  it('computes standard time and DST for the northern hemisphere', () => {
    expect(timezoneInfo('America/Los_Angeles', JAN)).toEqual({
      id: 'America/Los_Angeles',
      utc_offset: '-08:00',
      utc_offset_seconds: -28800,
      is_dst: false,
      current_time: '2026-01-15T04:00:00-08:00',
    });
    expect(timezoneInfo('America/Los_Angeles', JUL)).toMatchObject({
      utc_offset: '-07:00',
      is_dst: true,
      current_time: '2026-07-15T05:00:00-07:00',
    });
  });

  it('computes DST for the southern hemisphere', () => {
    expect(timezoneInfo('Australia/Sydney', JAN)).toMatchObject({
      utc_offset: '+11:00',
      is_dst: true,
    });
    expect(timezoneInfo('Australia/Sydney', JUL)).toMatchObject({
      utc_offset: '+10:00',
      is_dst: false,
    });
  });

  it('handles half-hour offsets and zones without DST', () => {
    expect(timezoneInfo('Asia/Kolkata', JUL)).toMatchObject({
      utc_offset: '+05:30',
      utc_offset_seconds: 19800,
      is_dst: false,
    });
    expect(timezoneInfo('UTC', JUL)).toMatchObject({ utc_offset: '+00:00', is_dst: false });
  });

  it('returns null fields for a missing or unknown zone', () => {
    expect(timezoneInfo(null)).toEqual({
      id: null,
      utc_offset: null,
      utc_offset_seconds: null,
      is_dst: null,
      current_time: null,
    });
    expect(timezoneInfo('Mars/Olympus_Mons')).toMatchObject({
      id: 'Mars/Olympus_Mons',
      utc_offset: null,
    });
  });
});

describe('formatOffset', () => {
  it.each([
    [0, '+00:00'],
    [-28800, '-08:00'],
    [19800, '+05:30'],
    [-9000, '-02:30'],
    [45900, '+12:45'],
  ])('%d -> %s', (seconds, text) => expect(formatOffset(seconds)).toBe(text));
});
