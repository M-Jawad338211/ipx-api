/**
 * Downloads the IP databases into data/ and asks the running API to hot-swap its readers.
 *
 *  - DB-IP City Lite (CC BY 4.0): current month, falling back to the previous month on 404.
 *    Skipped when data/ already holds that month's file (use --force to re-download).
 *  - IPinfo Lite (CC BY-SA 4.0): needs IPINFO_TOKEN; without it the existing file is kept.
 *
 * Every file is downloaded to data/*.tmp, validated with an mmdb reader, logged with its sha256
 * and then atomically renamed into place.
 * Usage: pnpm update-db [--force]
 */
import { readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Reader, type Response as MmdbResponse } from 'maxmind';
import {
  DATA_DIR,
  HttpError,
  alert,
  fetchWithRetry,
  log,
  notifyReload,
  redact,
  sha256,
  streamToFile,
  warn,
  writeFileAtomic,
} from './lib/common.ts';

const CITY_FILE = path.join(DATA_DIR, 'dbip-city-lite.mmdb');
const ASN_FILE = path.join(DATA_DIR, 'ipinfo_lite.mmdb');
const MANIFEST_FILE = path.join(DATA_DIR, 'manifest.json');

interface ManifestEntry {
  file: string;
  source: string;
  edition?: string;
  sha256: string;
  bytes: number;
  build_date: string;
  downloaded_at: string;
}

type Manifest = Record<string, ManifestEntry>;

interface Outcome {
  name: string;
  changed: boolean;
  ok: boolean;
}

function monthString(date: Date): string {
  return date.toISOString().slice(0, 7);
}

async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(MANIFEST_FILE, 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

async function fileSha256(file: string): Promise<string | null> {
  try {
    return sha256(await readFile(file));
  } catch {
    return null;
  }
}

/** Opens the mmdb file and checks it can answer a lookup for 8.8.8.8. Returns its build date. */
async function validateMmdb(
  file: string,
  expectType: RegExp,
  check: (record: MmdbResponse | null) => boolean,
): Promise<string> {
  const reader = new Reader<MmdbResponse>(await readFile(file));
  const type = reader.metadata.databaseType;
  if (!expectType.test(type)) throw new Error(`unexpected database type "${type}"`);
  if (!check(reader.get('8.8.8.8'))) throw new Error('test lookup for 8.8.8.8 failed');
  return reader.metadata.buildEpoch.toISOString();
}

async function existingBuildDate(file: string): Promise<string | null> {
  try {
    return new Reader<MmdbResponse>(await readFile(file)).metadata.buildEpoch.toISOString();
  } catch {
    return null;
  }
}

/**
 * Downloads `url` to `<dest>.tmp`, validates it and renames it over `dest` unless the content is
 * unchanged. Returns null when the server answers 404 (so the caller can try another URL).
 */
async function installMmdb(opts: {
  name: string;
  url: string;
  dest: string;
  gunzip: boolean;
  expectType: RegExp;
  check: (record: MmdbResponse | null) => boolean;
  manifest: Manifest;
  edition?: string;
}): Promise<{ changed: boolean } | null> {
  const { name, url, dest, manifest } = opts;
  const tmp = `${dest}.tmp`;
  log(`${name}: downloading ${redact(url)}`);
  const res = await fetchWithRetry(url, { passStatuses: [404], timeoutMs: 600_000 });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  try {
    const { bytes, sha256: digest } = await streamToFile(res, tmp, { gunzip: opts.gunzip });
    log(`${name}: downloaded ${(bytes / 1e6).toFixed(1)} MB, sha256 ${digest}`);
    const buildDate = await validateMmdb(tmp, opts.expectType, opts.check);
    log(`${name}: valid database, built ${buildDate}`);

    const changed = (await fileSha256(dest)) !== digest;
    if (changed) {
      await rename(tmp, dest);
      log(`${name}: installed ${dest}`);
    } else {
      await rm(tmp, { force: true });
      log(`${name}: unchanged (same sha256), keeping the current file`);
    }
    manifest[name] = {
      file: path.basename(dest),
      source: redact(url),
      ...(opts.edition ? { edition: opts.edition } : {}),
      sha256: digest,
      bytes,
      build_date: buildDate,
      downloaded_at: new Date().toISOString(),
    };
    return { changed };
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

async function updateDbip(manifest: Manifest, force: boolean): Promise<Outcome> {
  const name = 'dbip-city-lite';
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const months = [monthString(now), monthString(prev)];

  try {
    const installed = manifest[name];
    const fileExists = await stat(CITY_FILE).then(
      () => true,
      () => false,
    );
    for (const month of months) {
      // Editions never change once published, so an installed edition is not downloaded again
      // (this also covers the first days of a month, before DB-IP publishes the new file).
      if (!force && fileExists && installed?.edition === month) {
        log(`${name}: ${month} edition already installed, skipping (use --force to re-download)`);
        return { name, changed: false, ok: true };
      }
      const result = await installMmdb({
        name,
        url: `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`,
        dest: CITY_FILE,
        gunzip: true,
        expectType: /DBIP-City/i,
        check: (r) => (r as { country?: { iso_code?: string } } | null)?.country?.iso_code === 'US',
        manifest,
        edition: month,
      });
      if (result) return { name, changed: result.changed, ok: true };
      warn(`${name}: ${month} edition not published yet (404)`);
    }
    throw new Error(`no edition found for ${months.join(' or ')}`);
  } catch (error) {
    warn(`${name}: update failed, keeping the current file: ${(error as Error).message}`);
    return { name, changed: false, ok: false };
  }
}

async function updateIpinfo(manifest: Manifest): Promise<Outcome> {
  const name = 'ipinfo-lite';
  const token = process.env.IPINFO_TOKEN?.trim();
  if (!token) {
    const built = await existingBuildDate(ASN_FILE);
    warn(
      `${name}: IPINFO_TOKEN is not set, skipping download. ` +
        (built ? `Keeping ${ASN_FILE} (built ${built}).` : `No existing file at ${ASN_FILE}!`),
    );
    return { name, changed: false, ok: built !== null };
  }
  try {
    const result = await installMmdb({
      name,
      url: `https://ipinfo.io/data/ipinfo_lite.mmdb?token=${encodeURIComponent(token)}`,
      dest: ASN_FILE,
      gunzip: false,
      expectType: /ipinfo/i,
      check: (r) => (r as { asn?: string } | null)?.asn === 'AS15169',
      manifest,
    });
    if (!result) throw new HttpError('https://ipinfo.io/data/ipinfo_lite.mmdb', 404);
    return { name, changed: result.changed, ok: true };
  } catch (error) {
    warn(`${name}: update failed, keeping the current file: ${(error as Error).message}`);
    return { name, changed: false, ok: false };
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const manifest = await readManifest();
  const outcomes = [await updateDbip(manifest, force), await updateIpinfo(manifest)];
  await writeFileAtomic(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);

  if (outcomes.some((o) => o.changed)) await notifyReload();
  for (const o of outcomes) {
    log(`${o.name}: ${o.ok ? 'ok' : 'FAILED'}${o.changed ? ' (updated)' : ''}`);
  }
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.name);
  if (failed.length > 0) {
    await alert(`update-db failed for ${failed.join(', ')}; the previous files are still served`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
