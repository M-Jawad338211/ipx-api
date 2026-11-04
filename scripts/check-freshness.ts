/**
 * Alerts (ALERT_WEBHOOK_URL) when the running API reports stale or missing data: an IP database
 * older than 45 days, a Tor list older than 6 hours, a hosting list older than 3 days, or a
 * degraded status. Run hourly next to the API.
 * Usage: node scripts/check-freshness.ts   (HEALTH_URL defaults to http://127.0.0.1:8080/health)
 */
import { alert, log } from './lib/common.ts';

const url = process.env.HEALTH_URL || `http://127.0.0.1:${process.env.PORT || '8080'}/health`;

async function main(): Promise<void> {
  let body: { status?: string; warnings?: string[]; services?: Record<string, string> };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    body = (await res.json()) as typeof body;
  } catch (error) {
    await alert(`health check failed: ${url} is not answering (${(error as Error).message})`);
    process.exitCode = 1;
    return;
  }
  const problems = [...(body.warnings ?? [])];
  if (body.status !== 'ok') problems.unshift(`API status is ${body.status ?? 'unknown'}`);
  for (const [service, state] of Object.entries(body.services ?? {})) {
    if (state === 'error') problems.push(`${service} is unreachable`);
  }
  if (problems.length > 0) {
    await alert(`data or service problem: ${problems.join('; ')}`);
    process.exitCode = 1;
  } else {
    log('health ok: all data fresh');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
