import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import maxmind, { type Reader, type Response as MmdbResponse } from 'maxmind';
import type { Health } from '@ipx/shared';
import { countryCount } from '../enrich/countries.ts';
import { parseIp, type ParsedIp } from '../ip.ts';
import { CidrMatcher } from '../security/cidr.ts';

type Names = Partial<Record<string, string>>;

/** Shape of a DB-IP City Lite record (MaxMind GeoIP2-City compatible subset). */
export interface CityRecord {
  city?: { names?: Names };
  continent?: { code?: string; names?: Names };
  country?: { iso_code?: string; names?: Names; is_in_european_union?: boolean };
  location?: { latitude?: number; longitude?: number };
  subdivisions?: { names?: Names }[];
}

/** Shape of an IPinfo Lite record. */
export interface AsnRecord {
  asn?: string;
  as_name?: string;
  as_domain?: string;
  country?: string;
  country_code?: string;
  continent?: string;
  continent_code?: string;
}

export interface DataFiles {
  city: string;
  asn: string;
  tor: string;
  hosting: string;
}

export function dataFilesIn(dataDir: string, overrides: Partial<DataFiles> = {}): DataFiles {
  return {
    city: path.join(dataDir, 'dbip-city-lite.mmdb'),
    asn: path.join(dataDir, 'ipinfo_lite.mmdb'),
    tor: path.join(dataDir, 'tor-exits.json'),
    hosting: path.join(dataDir, 'hosting-ranges.json'),
    ...overrides,
  };
}

export interface StoreLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

type SourceName = keyof DataFiles;

interface SourceStatus {
  loaded: boolean;
  signature: string | null;
  loadedAt: number | null;
  /** Build date (mmdb) or download date (lists). */
  dataDate: number | null;
  databaseType: string | null;
  entries: number;
  error: string | null;
}

const MMDB_CACHE = { max: 20_000 };

/**
 * Holds the in-memory lookup data and swaps it atomically when files in data/ change.
 * Requests always read whatever references are current; a failed reload keeps the old data.
 */
export class DataStore {
  readonly files: DataFiles;
  readonly #log: StoreLogger;

  city: Reader<MmdbResponse> | null = null;
  asn: Reader<MmdbResponse> | null = null;
  tor: ReadonlySet<string> = new Set();
  hosting: CidrMatcher<string> = new CidrMatcher();
  /** Languages available for localized names (from the DB-IP metadata). */
  languages: readonly string[] = ['en'];

  readonly #status: Record<SourceName, SourceStatus>;
  #refreshing: Promise<SourceName[]> | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(files: DataFiles, log: StoreLogger) {
    this.files = files;
    this.#log = log;
    const empty = (): SourceStatus => ({
      loaded: false,
      signature: null,
      loadedAt: null,
      dataDate: null,
      databaseType: null,
      entries: 0,
      error: null,
    });
    this.#status = { city: empty(), asn: empty(), tor: empty(), hosting: empty() };
  }

  /** True when at least one IP database is available. */
  get ready(): boolean {
    return this.city !== null || this.asn !== null;
  }

  cityRecord(ip: ParsedIp): CityRecord | null {
    return safeGet(this.city, ip) as CityRecord | null;
  }

  asnRecord(ip: ParsedIp): AsnRecord | null {
    return safeGet(this.asn, ip) as AsnRecord | null;
  }

  isTor(ip: ParsedIp): boolean {
    return this.tor.has(ip.text);
  }

  hostingProvider(ip: ParsedIp): string | null {
    return this.hosting.match(ip) ?? null;
  }

  /**
   * Reloads every file whose size or mtime changed (all files when `force`). Concurrent calls
   * share one run. Never throws: failures are logged and recorded in the health status.
   */
  refresh(force = false): Promise<SourceName[]> {
    this.#refreshing ??= this.#refresh(force).finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  startAutoRefresh(seconds: number): void {
    this.stopAutoRefresh();
    if (seconds <= 0) return;
    this.#timer = setInterval(() => void this.refresh(), seconds * 1000);
    this.#timer.unref();
  }

  stopAutoRefresh(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async #refresh(force: boolean): Promise<SourceName[]> {
    const reloaded: SourceName[] = [];
    for (const name of ['city', 'asn', 'tor', 'hosting'] as const) {
      const status = this.#status[name];
      const file = this.files[name];
      let signature: string;
      try {
        const info = await stat(file);
        signature = `${info.size}:${info.mtimeMs}`;
      } catch {
        if (status.error === null || !status.error.startsWith('missing')) {
          this.#log.warn({ file }, `data file missing: ${name}`);
        }
        status.error = `missing file ${file}`;
        continue;
      }
      if (!force && signature === status.signature) continue;
      try {
        await this.#load(name, file);
        status.signature = signature;
        status.loaded = true;
        status.loadedAt = Date.now();
        status.error = null;
        reloaded.push(name);
        this.#log.info(
          { source: name, file, entries: status.entries || undefined },
          `loaded ${name} data`,
        );
      } catch (error) {
        status.error = (error as Error).message;
        this.#log.error({ source: name, file, err: error }, `failed to load ${name} data`);
      }
    }
    return reloaded;
  }

  async #load(name: SourceName, file: string): Promise<void> {
    const status = this.#status[name];
    if (name === 'city' || name === 'asn') {
      const reader = await maxmind.open<MmdbResponse>(file, { cache: MMDB_CACHE });
      // Sanity check before swapping: the database must answer a well-known address.
      if (!reader.get('8.8.8.8')) throw new Error('test lookup for 8.8.8.8 returned nothing');
      status.dataDate = reader.metadata.buildEpoch.getTime();
      status.databaseType = reader.metadata.databaseType;
      if (name === 'city') {
        this.languages = reader.metadata.languages.length ? reader.metadata.languages : ['en'];
        this.city = reader;
      } else {
        this.asn = reader;
      }
      return;
    }

    const json = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    if (name === 'tor') {
      const addresses = Array.isArray(json.addresses) ? (json.addresses as unknown[]) : [];
      const set = new Set<string>();
      for (const value of addresses) {
        const ip = typeof value === 'string' ? parseIp(value) : null;
        if (ip) set.add(ip.text);
      }
      this.tor = set;
      status.entries = set.size;
      status.dataDate = Date.parse(String(json.fetched_at)) || null;
      return;
    }

    // hosting: providers in priority order; a later provider wins for an identical prefix
    const providers = (json.providers ?? {}) as Record<string, { ranges?: unknown }>;
    const matcher = new CidrMatcher<string>();
    let invalid = 0;
    for (const [provider, data] of Object.entries(providers)) {
      for (const cidr of Array.isArray(data.ranges) ? (data.ranges as unknown[]) : []) {
        if (typeof cidr !== 'string' || !matcher.add(cidr, provider)) invalid++;
      }
    }
    if (invalid > 0) this.#log.warn({ invalid }, 'skipped invalid hosting ranges');
    this.hosting = matcher;
    status.entries = matcher.size;
    status.dataDate = Date.parse(String(json.generated_at)) || null;
  }

  health(now: number = Date.now()): Health {
    const db = (name: 'city' | 'asn') => {
      const s = this.#status[name];
      return {
        loaded: s.loaded,
        file: path.basename(this.files[name]),
        database_type: s.databaseType,
        build_date: s.dataDate ? new Date(s.dataDate).toISOString() : null,
        age_days: s.dataDate ? round((now - s.dataDate) / 86_400_000, 2) : null,
        loaded_at: s.loadedAt ? new Date(s.loadedAt).toISOString() : null,
        error: s.error,
      };
    };
    const list = (name: 'tor' | 'hosting') => {
      const s = this.#status[name];
      return {
        loaded: s.loaded,
        file: path.basename(this.files[name]),
        entries: s.entries,
        updated_at: s.dataDate ? new Date(s.dataDate).toISOString() : null,
        age_hours: s.dataDate ? round((now - s.dataDate) / 3_600_000, 2) : null,
        error: s.error,
      };
    };
    return {
      status: this.city && this.asn ? 'ok' : 'degraded',
      uptime_seconds: round(process.uptime(), 1),
      memory_rss_mb: round(process.memoryUsage.rss() / 1e6, 1),
      databases: { city: db('city'), asn: db('asn') },
      lists: { tor: list('tor'), hosting: list('hosting') },
      countries: countryCount(),
    };
  }
}

function safeGet(reader: Reader<MmdbResponse> | null, ip: ParsedIp): MmdbResponse | null {
  if (!reader) return null;
  try {
    return reader.get(ip.text);
  } catch {
    return null; // the reader rejects addresses outside its tree (e.g. IPv6 in an IPv4-only DB)
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
