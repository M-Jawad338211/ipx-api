import type { IpLookup, Locale, Location, Network, Security } from '@ipx/shared';
import type { DataStore } from '../data/store.ts';
import { getCountry, isEuMember } from '../enrich/countries.ts';
import { EMPTY_TIMEZONE, timezoneAt, timezoneInfo } from '../enrich/timezone.ts';
import { isReserved, type ParsedIp } from '../ip.ts';

type Names = Partial<Record<string, string>>;

/**
 * Resolves a `lang=` value against the languages the city database carries. Matching is
 * case-insensitive and falls back from "pt" to "pt-BR" (unique base match) and from "en-US" to
 * "en". Anything unknown becomes "en".
 */
export function resolveLanguage(input: string | undefined, available: readonly string[]): string {
  if (!input) return 'en';
  const wanted = input.trim().toLowerCase().replace('_', '-');
  const exact = available.find((lang) => lang.toLowerCase() === wanted);
  if (exact) return exact;
  const base = wanted.split('-')[0];
  const sameBase = available.filter((lang) => lang.toLowerCase().split('-')[0] === base);
  return sameBase.length === 1 ? sameBase[0]! : 'en';
}

/** DB-IP names sometimes carry padding or a trailing Spanish article ("Estados Unidos (los)"). */
function cleanName(name: string | undefined): string | null {
  if (!name) return null;
  const cleaned = name.trim().replace(/\s+\((el|la|los|las)\)$/, '');
  return cleaned || null;
}

function pickName(names: Names | undefined, lang: string): string | null {
  return cleanName(names?.[lang]) ?? cleanName(names?.en);
}

function parseAsn(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(?:AS)?(\d{1,10})$/i.exec(value.trim());
  if (!match) return null;
  const asn = Number(match[1]);
  return asn > 0 && asn <= 4_294_967_295 ? asn : null;
}

function emptyLocation(): Location {
  return {
    continent: null,
    continent_code: null,
    country: null,
    country_code: null,
    is_eu: null,
    region: null,
    city: null,
    postal: null,
    latitude: null,
    longitude: null,
  };
}

function emptySecurity(): Security {
  return {
    is_tor: false,
    is_proxy: false,
    is_vpn: false,
    is_hosting: false,
    hosting_provider: null,
    source: 'basic',
  };
}

function localeFor(countryCode: string | null): Locale {
  const country = getCountry(countryCode);
  const currency = country?.currencies[0];
  return {
    flag: country?.flag ?? null,
    calling_code: country?.calling_code ?? null,
    currency: currency
      ? { code: currency.code, name: currency.name, symbol: currency.symbol }
      : null,
    languages: country ? country.languages.map((l) => ({ code: l.code, name: l.name })) : [],
  };
}

/** Lookup result for a private, loopback or otherwise reserved address. */
export function reservedResult(ip: ParsedIp): IpLookup {
  return {
    success: true,
    ip: ip.text,
    type: ip.version === 4 ? 'ipv4' : 'ipv6',
    reserved: true,
    location: emptyLocation(),
    timezone: { ...EMPTY_TIMEZONE },
    network: { asn: null, as_name: null, as_domain: null },
    locale: { flag: null, calling_code: null, currency: null, languages: [] },
    security: emptySecurity(),
  };
}

/**
 * Builds the full lookup result. Country and ASN come from IPinfo Lite; city, region and
 * coordinates come from DB-IP City Lite, but only when DB-IP agrees with IPinfo on the country,
 * so a response never mixes two countries. Missing data becomes null; this never throws.
 */
export function lookupIp(
  store: DataStore,
  ip: ParsedIp,
  lang = 'en',
  now: number = Date.now(),
): IpLookup {
  if (isReserved(ip)) return reservedResult(ip);

  const asn = store.asnRecord(ip);
  const dbip = store.cityRecord(ip);
  const ipinfoCountry = asn?.country_code || null;
  const dbipCountry = dbip?.country?.iso_code || null;
  const countryCode = ipinfoCountry ?? dbipCountry;
  // DB-IP data is only used when it describes the same country as IPinfo.
  const city =
    dbip && dbipCountry && (!ipinfoCountry || ipinfoCountry === dbipCountry) ? dbip : null;

  const continentCode = asn?.continent_code || city?.continent?.code || null;
  const sameContinent = city?.continent?.code === continentCode;

  const location: Location = {
    continent:
      (lang !== 'en' && sameContinent ? pickName(city?.continent?.names, lang) : null) ??
      cleanName(asn?.continent) ??
      (sameContinent ? pickName(city?.continent?.names, 'en') : null),
    continent_code: continentCode,
    country:
      (lang !== 'en' && city ? pickName(city.country?.names, lang) : null) ??
      cleanName(asn?.country) ??
      pickName(city?.country?.names, 'en') ??
      getCountry(countryCode)?.name ??
      null,
    country_code: countryCode,
    is_eu: isEuMember(countryCode),
    region: cleanName(city?.subdivisions?.[0]?.names?.en),
    city: cleanName(city?.city?.names?.en),
    postal: null,
    latitude: city?.location?.latitude ?? null,
    longitude: city?.location?.longitude ?? null,
  };

  let zone: string | null = null;
  if (location.latitude !== null && location.longitude !== null) {
    zone = timezoneAt(location.latitude, location.longitude);
  }
  if (!zone) {
    // No usable coordinates: fall back to the country's zone when it has exactly one.
    const zones = getCountry(countryCode)?.timezones;
    if (zones?.length === 1) zone = zones[0]!;
  }

  const network: Network = {
    asn: parseAsn(asn?.asn),
    as_name: cleanName(asn?.as_name),
    as_domain: cleanName(asn?.as_domain),
  };

  const provider = store.hostingProvider(ip);
  const security: Security = {
    is_tor: store.isTor(ip),
    is_proxy: false,
    is_vpn: false,
    is_hosting: provider !== null,
    hosting_provider: provider,
    source: 'basic',
  };

  return {
    success: true,
    ip: ip.text,
    type: ip.version === 4 ? 'ipv4' : 'ipv6',
    reserved: false,
    location,
    timezone: timezoneInfo(zone, now),
    network,
    locale: localeFor(countryCode),
    security,
  };
}
