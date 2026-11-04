/**
 * External uptime check for the public status page. Runs in GitHub Actions (outside the
 * server), probes each URL, keeps 90 days of daily results in history.json and renders a
 * self-contained index.html that GitHub Pages serves at status.<domain>.
 *
 * Usage: STATUS_CHECKS="API=https://api.example.com/health,Website=https://example.com/" \
 *        node scripts/status-check.ts --dir status-site [--domain status.example.com]
 * Incidents are edited by hand in <dir>/incidents.json:
 *   [{ "date": "2026-11-04", "title": "API slow", "body": "...", "resolved": true }]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { log, writeFileAtomic } from './lib/common.ts';

const DAYS = 90;

interface Day {
  up: number;
  total: number;
  ms: number;
}
interface CheckHistory {
  url: string;
  days: Record<string, Day>;
  last?: { at: string; ok: boolean; status: number | null; ms: number; error?: string };
}
interface History {
  updated_at: string;
  checks: Record<string, CheckHistory>;
}
interface Incident {
  date: string;
  title: string;
  body?: string;
  resolved?: boolean;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function parseChecks(spec: string): { name: string; url: string }[] {
  return spec
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq < 1) throw new Error(`STATUS_CHECKS entry "${part}" must be Name=URL`);
      return { name: part.slice(0, eq).trim(), url: part.slice(eq + 1).trim() };
    });
}

async function probe(url: string) {
  const started = performance.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'ipx-status-check/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
    return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - started) };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    return { ok: false, status: null, ms, error: (error as Error).message };
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function lastDays(now: Date): string[] {
  return Array.from({ length: DAYS }, (_, i) =>
    new Date(now.getTime() - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

function uptime(days: Record<string, Day>, keys: string[]): number | null {
  let up = 0;
  let total = 0;
  for (const k of keys) {
    up += days[k]?.up ?? 0;
    total += days[k]?.total ?? 0;
  }
  return total === 0 ? null : (up / total) * 100;
}

function color(pct: number | null): string {
  if (pct === null) return '#d4d4d8';
  if (pct >= 99.9) return '#22c55e';
  if (pct >= 99) return '#84cc16';
  if (pct >= 95) return '#f59e0b';
  return '#ef4444';
}

export function renderPage(history: History, incidents: Incident[], now = new Date()): string {
  const keys = lastDays(now);
  const checks = Object.entries(history.checks);
  const down = checks.filter(([, c]) => c.last && !c.last.ok).map(([name]) => name);
  const banner =
    checks.length === 0
      ? { text: 'No checks yet', bg: '#71717a' }
      : down.length === 0
        ? { text: 'All systems operational', bg: '#16a34a' }
        : { text: `Outage: ${down.join(', ')}`, bg: '#dc2626' };

  const sections = checks
    .map(([name, c]) => {
      const pct = uptime(c.days, keys);
      const bars = keys
        .map((k) => {
          const d = c.days[k];
          const dayPct = d && d.total > 0 ? (d.up / d.total) * 100 : null;
          const label = dayPct === null ? `${k}: no data` : `${k}: ${dayPct.toFixed(2)}% up`;
          return `<span class="bar" style="background:${color(dayPct)}" title="${esc(label)}"></span>`;
        })
        .join('');
      const state = c.last
        ? c.last.ok
          ? `<span class="pill ok">Operational</span>`
          : `<span class="pill down">Down</span>`
        : `<span class="pill">Unknown</span>`;
      const detail = c.last
        ? `Last check ${esc(new Date(c.last.at).toUTCString())}: ${c.last.status ?? esc(c.last.error ?? 'no response')}, ${c.last.ms} ms`
        : 'Not checked yet';
      return `<section class="check">
  <div class="row"><h2>${esc(name)}</h2>${state}</div>
  <div class="bars">${bars}</div>
  <div class="row muted"><span>${DAYS} days ago</span><span>${pct === null ? 'no data' : `${pct.toFixed(2)}% uptime`}</span><span>Today</span></div>
  <p class="muted small">${detail}</p>
</section>`;
    })
    .join('\n');

  const incidentList =
    incidents.length === 0
      ? '<p class="muted">No incidents reported.</p>'
      : [...incidents]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map(
            (
              i,
            ) => `<article class="incident"><div class="row"><h3>${esc(i.title)}</h3><span class="pill ${i.resolved ? 'ok' : 'down'}">${i.resolved ? 'Resolved' : 'Ongoing'}</span></div>
  <p class="muted small">${esc(i.date)}</p>${i.body ? `<p>${esc(i.body)}</p>` : ''}</article>`,
          )
          .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ipx status</title><meta http-equiv="refresh" content="300">
<style>
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#fafafa;color:#18181b}
main{max-width:760px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;margin:0 0 16px}h2{font-size:16px;margin:0}h3{font-size:15px;margin:0}
.banner{color:#fff;border-radius:10px;padding:14px 18px;font-weight:600;margin-bottom:24px}
.check,.incident{background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:16px 18px;margin-bottom:14px}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px}
.bars{display:flex;gap:2px;margin:12px 0 6px}.bar{flex:1;height:30px;border-radius:2px}
.muted{color:#71717a}.small{font-size:13px;margin:6px 0 0}
.pill{font-size:12px;border-radius:999px;padding:2px 10px;background:#e4e4e7}
.pill.ok{background:#dcfce7;color:#166534}.pill.down{background:#fee2e2;color:#991b1b}
footer{margin-top:28px;font-size:13px;color:#71717a}
</style></head>
<body><main>
<h1>ipx status</h1>
<div class="banner" style="background:${banner.bg}">${esc(banner.text)}</div>
${sections}
<h2 style="margin:28px 0 12px">Incidents</h2>
${incidentList}
<footer>Checked every 5 minutes from outside the service. Updated ${esc(new Date(history.updated_at).toUTCString())}.</footer>
</main></body></html>
`;
}

async function main(): Promise<void> {
  const dir = path.resolve(arg('--dir') ?? 'status-site');
  const checks = parseChecks(process.env.STATUS_CHECKS ?? '');
  if (checks.length === 0) throw new Error('STATUS_CHECKS is empty');
  const historyFile = path.join(dir, 'history.json');
  const history = await readJson<History>(historyFile, { updated_at: '', checks: {} });
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const keep = new Set(lastDays(now));

  for (const { name, url } of checks) {
    const result = await probe(url);
    const entry = (history.checks[name] ??= { url, days: {} });
    entry.url = url;
    const day = (entry.days[today] ??= { up: 0, total: 0, ms: 0 });
    day.total += 1;
    if (result.ok) day.up += 1;
    day.ms = Math.round((day.ms * (day.total - 1) + result.ms) / day.total);
    entry.last = { at: now.toISOString(), ...result };
    for (const key of Object.keys(entry.days)) if (!keep.has(key)) delete entry.days[key];
    log(`${name}: ${result.ok ? 'up' : 'DOWN'} (${result.status ?? result.error}) ${result.ms} ms`);
  }
  // Checks removed from STATUS_CHECKS disappear from the page.
  for (const name of Object.keys(history.checks)) {
    if (!checks.some((c) => c.name === name)) delete history.checks[name];
  }
  history.updated_at = now.toISOString();

  const incidents = await readJson<Incident[]>(path.join(dir, 'incidents.json'), []);
  await writeFileAtomic(historyFile, `${JSON.stringify(history, null, 1)}\n`);
  await writeFileAtomic(path.join(dir, 'index.html'), renderPage(history, incidents, now));
  const domain = arg('--domain');
  if (domain) await writeFileAtomic(path.join(dir, 'CNAME'), `${domain}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
