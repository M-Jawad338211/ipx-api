import { readFileSync } from 'node:fs';

/**
 * Static country facts (flag, calling code, currencies, languages, IANA zones), built by
 * `pnpm build-countries` from mledoze/countries (ODbL-1.0) and the IANA zone.tab file.
 */
export interface CountryInfo {
  name: string;
  flag: string | null;
  calling_code: string | null;
  currencies: { code: string; name: string | null; symbol: string | null }[];
  languages: { code: string; name: string }[];
  continent_code: string | null;
  timezones: string[];
}

interface CountriesFile {
  countries: Record<string, CountryInfo>;
}

const COUNTRIES: ReadonlyMap<string, CountryInfo> = new Map(
  Object.entries(
    (
      JSON.parse(
        readFileSync(new URL('./countries.json', import.meta.url), 'utf8'),
      ) as CountriesFile
    ).countries,
  ),
);

/** European Union member states (27, since 2020-02-01). */
const EU_MEMBERS: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]); // prettier-ignore

export function getCountry(code: string | null | undefined): CountryInfo | undefined {
  return code ? COUNTRIES.get(code) : undefined;
}

export function isEuMember(code: string | null | undefined): boolean | null {
  return code ? EU_MEMBERS.has(code) : null;
}

export function countryCount(): number {
  return COUNTRIES.size;
}
