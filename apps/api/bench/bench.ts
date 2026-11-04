/**
 * Load test: starts the API as a child process (single Node process, real data from data/) and
 * drives it with autocannon. Target from PLAN.md: >= 5,000 req/s and < 5 ms p99 on a laptop.
 * Usage: pnpm bench   (BENCH_DURATION=20 to change the seconds per scenario)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import autocannon, { type Result } from 'autocannon';
import { isReserved, ipv4ToString, parseIp, bigIntToIpv6 } from '../src/ip.ts';

// Use the repo .env (REDIS_URL, DATABASE_URL) so the rate limiter runs as in production.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../../.env'));
} catch {
  // no .env
}

const PORT = Number(process.env.BENCH_PORT || 18_081);
const BASE = `http://127.0.0.1:${PORT}`;
const DURATION = Number(process.env.BENCH_DURATION || 15);
const TARGET_RPS = 5_000;
const TARGET_P99_MS = 5;

function randomPublicIps(count: number): string[] {
  const ips: string[] = [];
  // ~90 % IPv4, ~10 % IPv6 from the RIR blocks that are actually allocated.
  const v6Blocks = [0x2a00n, 0x2400n, 0x2600n, 0x2800n, 0x2c00n, 0x2001n];
  while (ips.length < count) {
    let text: string;
    if (Math.random() < 0.9) {
      text = ipv4ToString(Math.floor(Math.random() * 0xffffffff) >>> 0);
    } else {
      const block = v6Blocks[Math.floor(Math.random() * v6Blocks.length)]!;
      let value = block << 112n;
      for (let shift = 0n; shift < 112n; shift += 16n) {
        value |= BigInt(Math.floor(Math.random() * 0x10000)) << shift;
      }
      text = bigIntToIpv6(value);
    }
    const ip = parseIp(text);
    if (ip && !isReserved(ip)) ips.push(ip.text);
  }
  return ips;
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('API did not become healthy in time (is data/ populated? run pnpm update-db)');
}

interface Scenario {
  name: string;
  connections: number;
  paths: () => string;
  primary?: boolean;
}

async function run(scenario: Scenario, duration: number): Promise<Result> {
  return autocannon({
    url: BASE,
    connections: scenario.connections,
    duration,
    requests: [{ method: 'GET', setupRequest: (req) => ({ ...req, path: scenario.paths() }) }],
  });
}

const ips = randomPublicIps(50_000);
let cursor = 0;
const nextIp = () => `/v1/json/${ips[cursor++ % ips.length]}`;

const scenarios: Scenario[] = [
  { name: 'random IPs, 10 connections', connections: 10, paths: nextIp, primary: true },
  { name: 'random IPs, 50 connections', connections: 50, paths: nextIp },
  { name: 'fixed 8.8.8.8, 10 connections', connections: 10, paths: () => '/v1/json/8.8.8.8' },
  {
    name: 'random IPs + fields=, 10 connections',
    connections: 10,
    paths: () => `${nextIp()}?fields=ip,location.country_code,security`,
  },
];

const server = spawn(process.execPath, [path.resolve(import.meta.dirname, '../src/server.ts')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
    DATA_REFRESH_SECONDS: '0',
    // Every request still runs the Redis limiter script; the limits are just out of reach.
    ANON_LIMIT_PER_MINUTE: '1000000000',
    ANON_LIMIT_PER_DAY: '1000000000',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

try {
  await waitForHealth(60_000);
  const probe = await fetch(`${BASE}${nextIp()}`);
  if (!probe.ok) {
    throw new Error(`Sanity request failed: HTTP ${probe.status} ${await probe.text()}`);
  }
  console.log(`Warming up (5 s, ${ips.length} distinct random IPs)...`);
  await run(scenarios[0]!, 5);

  const rows: string[][] = [];
  let primaryPass = false;
  for (const scenario of scenarios) {
    console.log(`Running: ${scenario.name} (${DURATION} s)`);
    const r = await run(scenario, DURATION);
    const failures = r.errors + r.timeouts + r.non2xx;
    if (failures > 0) console.log(`  failures: ${JSON.stringify({ errors: r.errors, timeouts: r.timeouts, non2xx: r.non2xx, codes: r.statusCodeStats })}`);
    rows.push([
      scenario.name,
      Math.round(r.requests.average).toLocaleString('en-US'),
      r.latency.p50.toFixed(2),
      r.latency.p99.toFixed(2),
      r.latency.max.toFixed(2),
      String(failures),
    ]);
    if (scenario.primary) {
      primaryPass =
        r.requests.average >= TARGET_RPS && r.latency.p99 < TARGET_P99_MS && failures === 0;
    }
  }
  const health = (await (await fetch(`${BASE}/health`)).json()) as { memory_rss_mb: number };

  const header = ['scenario', 'req/s', 'p50 ms', 'p99 ms', 'max ms', 'errors'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(`\n${line(header)}\n${widths.map((w) => '-'.repeat(w)).join('  ')}`);
  for (const row of rows) console.log(line(row));
  console.log(`\nServer RSS after the run: ${health.memory_rss_mb} MB (single process)`);
  console.log(
    `Target (>= ${TARGET_RPS.toLocaleString('en-US')} req/s and p99 < ${TARGET_P99_MS} ms on "${scenarios[0]!.name}"): ${primaryPass ? 'PASS' : 'FAIL'}`,
  );
} finally {
  server.kill('SIGTERM');
}
