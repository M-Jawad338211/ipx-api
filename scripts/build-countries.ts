/**
 * Builds apps/api/src/enrich/countries.json from:
 *  - mledoze/countries (ODbL-1.0): flag, calling code, currencies, languages, English name
 *  - IANA tz database zone.tab (public domain): IANA time zones per country
 *
 * The output is committed to the repo (it changes rarely); re-run this script to refresh it.
 * Usage: pnpm build-countries
 */
import path from 'node:path';
import { REPO_ROOT, fetchJson, fetchText, log, warn, writeFileAtomic } from './lib/common.ts';

const MLEDOZE_URL = 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';
const ZONE_TAB_URL = 'https://data.iana.org/time-zones/tzdb/zone.tab';
const OUTPUT = path.join(REPO_ROOT, 'apps/api/src/enrich/countries.json');
/** Code -> English name, for forms in the website. */
const NAMES_OUTPUT = path.join(REPO_ROOT, 'packages/shared/src/country-names.json');

interface MledozeCountry {
  cca2: string;
  name: { common: string };
  flag?: string;
  idd?: { root?: string; suffixes?: string[] };
  currencies?: Record<string, { name?: string; symbol?: string }>;
  languages?: Record<string, string>;
  region?: string;
  subregion?: string;
}

/** mledoze region/subregion -> two-letter continent code (as used by IPinfo and DB-IP). */
function continentCode(c: MledozeCountry): string | null {
  switch (c.region) {
    case 'Africa':
      return 'AF';
    case 'Antarctic':
      return 'AN';
    case 'Asia':
      return 'AS';
    case 'Europe':
      return 'EU';
    case 'Oceania':
      return 'OC';
    case 'Americas':
      return c.subregion === 'South America' ? 'SA' : 'NA';
    default:
      return null;
  }
}

interface CountryInfo {
  name: string;
  flag: string | null;
  calling_code: string | null;
  currencies: { code: string; name: string | null; symbol: string | null }[];
  languages: { code: string; name: string }[];
  continent_code: string | null;
  timezones: string[];
}

/**
 * mledoze stores calling codes as a root plus suffixes ("+9" + ["2"] = "+92"). Countries that
 * share a root with many suffixes (NANP "+1", "+7") use the root alone.
 */
function callingCode(idd: MledozeCountry['idd']): string | null {
  const root = idd?.root ?? '';
  const suffixes = idd?.suffixes ?? [];
  if (!root) return null;
  if (suffixes.length === 1) return `${root}${suffixes[0]}`;
  if (suffixes.length === 0 || root === '+1' || root === '+7') return root;
  // A bare one-digit root other than +1/+7 is not a real calling code: use the shortest suffix,
  // which is the ITU-assigned code (Vatican City: "+3" + ["906698", "79"] -> "+379").
  const shortest = [...suffixes].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  return `${root}${shortest}`;
}

function parseZoneTab(text: string): Map<string, string[]> {
  const zones = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [code, , zone] = line.split('\t');
    if (!code || !zone) continue;
    const list = zones.get(code) ?? [];
    list.push(zone);
    zones.set(code, list);
  }
  return zones;
}

async function main(): Promise<void> {
  log(`Downloading ${MLEDOZE_URL}`);
  const source = await fetchJson<MledozeCountry[]>(MLEDOZE_URL);
  log(`Downloading ${ZONE_TAB_URL}`);
  const zones = parseZoneTab(await fetchText(ZONE_TAB_URL));

  if (!Array.isArray(source) || source.length < 200) {
    throw new Error(
      `Unexpected mledoze data: ${Array.isArray(source) ? source.length : 'not an array'}`,
    );
  }

  const countries: Record<string, CountryInfo> = {};
  for (const c of [...source].sort((a, b) => a.cca2.localeCompare(b.cca2))) {
    if (!/^[A-Z]{2}$/.test(c.cca2)) {
      warn(`Skipping invalid cca2 ${JSON.stringify(c.cca2)}`);
      continue;
    }
    countries[c.cca2] = {
      name: c.name.common,
      flag: c.flag ?? null,
      calling_code: callingCode(c.idd),
      currencies: Object.entries(c.currencies ?? {}).map(([code, cur]) => ({
        code,
        name: cur.name ?? null,
        symbol: cur.symbol ?? null,
      })),
      languages: Object.entries(c.languages ?? {}).map(([code, name]) => ({ code, name })),
      continent_code: continentCode(c),
      timezones: zones.get(c.cca2) ?? [],
    };
  }

  const output = {
    sources: [
      { name: 'mledoze/countries', url: MLEDOZE_URL, license: 'ODbL-1.0' },
      { name: 'IANA tz database zone.tab', url: ZONE_TAB_URL, license: 'public domain' },
    ],
    generated_at: new Date().toISOString().slice(0, 10),
    countries,
  };
  await writeFileAtomic(OUTPUT, `${JSON.stringify(output, null, 1)}\n`);
  const names = Object.fromEntries(Object.entries(countries).map(([code, c]) => [code, c.name]));
  await writeFileAtomic(NAMES_OUTPUT, `${JSON.stringify(names, null, 1)}\n`);
  const count = Object.keys(countries).length;
  const singleZone = Object.values(countries).filter((c) => c.timezones.length === 1).length;
  log(
    `Wrote ${path.relative(REPO_ROOT, OUTPUT)}: ${count} countries (${singleZone} with a single time zone)`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
