import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Health } from '@ipx/shared';
import type { DataStore } from '../data/store.ts';
import { hasForwardingHeaders } from '../http/client-ip.ts';
import { HttpError } from '../http/errors.ts';
import { isLoopback } from '../ip.ts';
import type { Metrics } from '../metrics.ts';
import type { Services } from '../services.ts';

export async function systemRoutes(
  app: FastifyInstance,
  opts: { store: DataStore; services: Services; metrics: Metrics; metricsToken: string | null },
): Promise<void> {
  const { store, services } = opts;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        operationId: 'health',
        security: [],
        summary: 'Service health and data freshness',
        description:
          'HTTP 200 when both IP databases are loaded, 503 (`status: "degraded"`) otherwise. Includes the build date and age of each database and list.',
        response: { 200: Health, 503: Health },
      },
    },
    async (_request, reply) => {
      const health = { ...store.health(), services: await services.status() };
      reply.code(health.status === 'ok' ? 200 : 503).header('cache-control', 'no-store');
      return health;
    },
  );

  // Called by scripts/update-*.ts after they replace files in data/. Only reachable from a local
  // process: requests that came through a proxy (Cloudflare Tunnel, Caddy) carry forwarding headers.
  typed.post('/internal/reload', { schema: { hide: true } }, async (request) => {
    if (!isLoopback(request.socket.remoteAddress) || hasForwardingHeaders(request.headers)) {
      throw new HttpError(404, 'not_found', 'Route POST /internal/reload not found');
    }
    const reloaded = await store.refresh(true);
    request.log.info({ reloaded }, 'data reload requested');
    return { success: true, reloaded };
  });

  typed.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  // Prometheus scrape endpoint: bearer METRICS_TOKEN, or a local process when no token is set.
  typed.get('/metrics', { schema: { hide: true } }, async (request, reply) => {
    const token = opts.metricsToken;
    const allowed = token
      ? request.headers.authorization === `Bearer ${token}`
      : isLoopback(request.socket.remoteAddress) && !hasForwardingHeaders(request.headers);
    if (!allowed) throw new HttpError(404, 'not_found', 'Route GET /metrics not found');
    return reply
      .type('text/plain; version=0.0.4; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(opts.metrics.render());
  });
}
