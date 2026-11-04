/**
 * Downloads the security lists the API merges into every lookup:
 *  - Tor exit addresses   -> data/tor-exits.json      (run hourly:  --tor)
 *  - Hosting/cloud ranges -> data/hosting-ranges.json (run daily:   --hosting)
 *
 * With no flag both lists are refreshed. A source that fails keeps its previous data and makes
 * the script exit with code 1 (so a scheduler can alert), but the other sources still update.
 * Usage: pnpm update-security [--tor] [--hosting]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DATA_DIR,
  alert,
  fetchJson,
  fetchText,
  isCidr,
  isIpv4,
  isIpv6,
  log,
  notifyReload,
  warn,
  writeFileAtomic,
} from './lib/common.ts';

const TOR_FILE = path.join(DATA_DIR, 'tor-exits.json');
const HOSTING_FILE = path.join(DATA_DIR, 'hosting-ranges.json');

const TOR_URL = 'https://check.torproject.org/exit-addresses';
const AZURE_PAGE_URL = 'https://www.microsoft.com/en-us/download/details.aspx?id=56519';

interface ProviderSource {
  provider: string;
  url: string;
  load: () => Promise<string[]>;
}

interface ProviderData {
  source: string;
  fetched_at: string;
  count: number;
  stale?: boolean;
  error?: string;
  ranges: string[];
}

interface HostingFile {
  generated_at: string;
  providers: Record<string, ProviderData>;
}

/** Order matters to the API: later providers win when two lists contain the same prefix. */
const HOSTING_SOURCES: ProviderSource[] = [
  {
    provider: 'Google',
    url: 'https://www.gstatic.com/ipranges/goog.json',
    load: async () => googlePrefixes(await fetchJson('https://www.gstatic.com/ipranges/goog.json')),
  },
  {
    provider: 'Google Cloud',
    url: 'https://www.gstatic.com/ipranges/cloud.json',
    load: async () =>
      googlePrefixes(await fetchJson('https://www.gstatic.com/ipranges/cloud.json')),
  },
  {
    provider: 'AWS',
    url: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
    load: async () => {
      const data = await fetchJson<{
        prefixes?: { ip_prefix?: string }[];
        ipv6_prefixes?: { ipv6_prefix?: string }[];
      }>('https://ip-ranges.amazonaws.com/ip-ranges.json');
      return [
        ...(data.prefixes ?? []).map((p) => p.ip_prefix),
        ...(data.ipv6_prefixes ?? []).map((p) => p.ipv6_prefix),
      ].filter((p): p is string => typeof p === 'string');
    },
  },
  {
    provider: 'Microsoft Azure',
    url: AZURE_PAGE_URL,
    load: async () => {
      // The ServiceTags file name changes weekly; the download page links the current one.
      const page = await fetchText(AZURE_PAGE_URL);
      const match =
        /https:\/\/download\.microsoft\.com\/download\/[^"'\s<>]+ServiceTags_Public_\d+\.json/.exec(
          page,
        );
      if (!match) throw new Error('ServiceTags JSON link not found on the Azure download page');
      const data = await fetchJson<{
        values?: { name?: string; properties?: { addressPrefixes?: string[] } }[];
      }>(match[0]);
      const cloud = (data.values ?? []).find((v) => v.name === 'AzureCloud');
      if (!cloud?.properties?.addressPrefixes) throw new Error('AzureCloud tag missing');
      return cloud.properties.addressPrefixes;
    },
  },
  {
    provider: 'Cloudflare',
    url: 'https://www.cloudflare.com/ips-v4',
    load: async () => {
      const [v4, v6] = await Promise.all([
        fetchText('https://www.cloudflare.com/ips-v4'),
        fetchText('https://www.cloudflare.com/ips-v6'),
      ]);
      return `${v4}\n${v6}`.split('\n').map((line) => line.trim());
    },
  },
  {
    provider: 'DigitalOcean',
    url: 'https://www.digitalocean.com/geo/google.csv',
    load: async () => {
      const csv = await fetchText('https://www.digitalocean.com/geo/google.csv');
      return csv.split('\n').map((line) => line.split(',')[0]?.trim() ?? '');
    },
  },
];

function googlePrefixes(data: unknown): string[] {
  const prefixes = (data as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] }).prefixes;
  return (prefixes ?? [])
    .map((p) => p.ipv4Prefix ?? p.ipv6Prefix)
    .filter((p): p is string => typeof p === 'string');
}

function cleanRanges(raw: string[]): { ranges: string[]; invalid: number } {
  const unique = new Set<string>();
  let invalid = 0;
  for (const value of raw) {
    const cidr = value.trim();
    if (!cidr) continue;
    if (isCidr(cidr)) unique.add(cidr.toLowerCase());
    else invalid++;
  }
  return { ranges: [...unique].sort(), invalid };
}

/** Parses the Tor Project's exit-addresses format ("ExitAddress 1.2.3.4 2026-11-03 12:00:00"). */
function parseTorExitAddresses(text: string): string[] {
  const addresses = new Set<string>();
  for (const line of text.split('\n')) {
    const match = /^ExitAddress\s+(\S+)/.exec(line.trim());
    const ip = match?.[1];
    if (ip && (isIpv4(ip) || isIpv6(ip))) addresses.add(ip);
  }
  return [...addresses].sort();
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function updateTor(): Promise<boolean> {
  log(`Tor: downloading ${TOR_URL}`);
  try {
    const addresses = parseTorExitAddresses(await fetchText(TOR_URL));
    if (addresses.length < 100) throw new Error(`only ${addresses.length} exit addresses parsed`);
    const output = {
      source: TOR_URL,
      fetched_at: new Date().toISOString(),
      count: addresses.length,
      addresses,
    };
    await writeFileAtomic(TOR_FILE, `${JSON.stringify(output)}\n`);
    log(`Tor: wrote ${addresses.length} exit addresses to ${TOR_FILE}`);
    return true;
  } catch (error) {
    warn(`Tor: update failed, keeping the previous list: ${(error as Error).message}`);
    return false;
  }
}

async function updateHosting(): Promise<boolean> {
  const previous = await readJson<HostingFile>(HOSTING_FILE);
  const providers: Record<string, ProviderData> = {};
  let ok = true;

  const results = await Promise.allSettled(
    HOSTING_SOURCES.map(async (source) => {
      const { ranges, invalid } = cleanRanges(await source.load());
      if (ranges.length === 0) throw new Error('no valid ranges in response');
      if (invalid > 0) warn(`Hosting: ${source.provider}: skipped ${invalid} invalid entries`);
      return ranges;
    }),
  );
  results.forEach((result, i) => {
    const source = HOSTING_SOURCES[i]!;
    if (result.status === 'fulfilled') {
      providers[source.provider] = {
        source: source.url,
        fetched_at: new Date().toISOString(),
        count: result.value.length,
        ranges: result.value,
      };
      log(`Hosting: ${source.provider}: ${result.value.length} ranges`);
      return;
    }
    ok = false;
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    const old = previous?.providers?.[source.provider];
    if (old && old.ranges.length > 0) {
      warn(`Hosting: ${source.provider} failed (${message}); keeping ${old.count} previous ranges`);
      providers[source.provider] = { ...old, stale: true, error: message };
    } else {
      warn(`Hosting: ${source.provider} failed (${message}); no previous data`);
    }
  });

  if (Object.keys(providers).length === 0) {
    warn('Hosting: every source failed; data/hosting-ranges.json left unchanged');
    return false;
  }
  const output: HostingFile = { generated_at: new Date().toISOString(), providers };
  await writeFileAtomic(HOSTING_FILE, `${JSON.stringify(output)}\n`);
  const total = Object.values(providers).reduce((sum, p) => sum + p.count, 0);
  log(`Hosting: wrote ${total} ranges from ${Object.keys(providers).length} providers`);
  return ok;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const all = !args.has('--tor') && !args.has('--hosting');
  let ok = true;
  if (all || args.has('--tor')) ok = (await updateTor()) && ok;
  if (all || args.has('--hosting')) ok = (await updateHosting()) && ok;
  await notifyReload();
  if (!ok) {
    await alert('update-security: at least one source failed; previous data kept (see logs)');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
