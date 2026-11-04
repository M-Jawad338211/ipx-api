import swagger from '@fastify/swagger';
import type { ErrorCode } from '@ipx/shared';
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { Config } from './config.ts';
import { DataStore, dataFilesIn, type DataFiles } from './data/store.ts';
import { HttpError, errorBody } from './http/errors.ts';
import { isValidCallback, jsonpBody } from './http/format.ts';
import { batchRoutes } from './routes/batch.ts';
import { JSON_TYPE, JS_TYPE, lookupRoutes } from './routes/lookup.ts';
import { systemRoutes } from './routes/system.ts';
import { Services } from './services.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The route answers `callback=` with JSONP, errors included. */
    jsonp?: boolean;
  }
  interface FastifyInstance {
    store: DataStore;
    services: Services;
  }
}

export interface AppOptions {
  config: Config;
  /** Pre-built store (tests); otherwise one is created for config.dataDir. */
  store?: DataStore;
  files?: Partial<DataFiles>;
  /** Fastify logger option; defaults to pino at config.logLevel. */
  logger?: boolean | { level: string };
}

/** Keeps API keys out of logs (`?key=...` in request URLs). */
export function redactUrl(url: string): string {
  return url.replace(/([?&]key=)[^&]*/gi, '$1***');
}

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string,
) {
  const body = errorBody(code, message);
  const callback = (request.query as Record<string, unknown> | undefined)?.callback;
  if (
    request.routeOptions.config?.jsonp &&
    typeof callback === 'string' &&
    isValidCallback(callback)
  ) {
    // Browsers hide the body of failed <script> loads, so JSONP errors go out as 200.
    return reply
      .code(200)
      .type(JS_TYPE)
      .header('x-content-type-options', 'nosniff')
      .send(jsonpBody(callback, body));
  }
  return reply.code(status).type(JSON_TYPE).send(body);
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: options.logger === true ? 'info' : (options.logger?.level ?? config.logLevel),
            serializers: {
              req: (req: { method: string; url: string; ip?: string }) => ({
                method: req.method,
                url: redactUrl(req.url),
              }),
            },
          },
    logController: new LogController({ disableRequestLogging: !config.logRequests }),
    routerOptions: { ignoreTrailingSlash: true },
    trustProxy: false,
    return503OnClosing: true,
    bodyLimit: 64 * 1024,
    // Malformed URLs and over-long path segments are rejected by the router before any route
    // runs; answer them in the API's error shape too.
    frameworkErrors: (error, request, rawReply) => {
      const reply = rawReply as FastifyReply;
      const path = (request.raw.url ?? '').split('?')[0] ?? '';
      const isLookup = /^\/(v1\/)?json\//.test(path);
      if (isLookup) reply.header('access-control-allow-origin', '*');
      const body = isLookup
        ? errorBody('invalid_ip', 'The IP address in the URL is not a valid IPv4 or IPv6 address')
        : errorBody('invalid_request', error.message);
      void reply.code(400).type(JSON_TYPE).send(body);
    },
  });

  const store = options.store ?? new DataStore(dataFilesIn(config.dataDir, options.files), app.log);
  app.decorate('store', store);
  const services = new Services(config, app.log);
  app.decorate('services', services);
  app.addHook('onClose', async () => services.close());

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'ipx IP Lookup API',
        version: '1.0.0',
        description:
          'Geolocation, network, time zone, locale and security data for any IPv4 or IPv6 address. IP data by DB-IP (https://db-ip.com, CC BY 4.0) and IPinfo (https://ipinfo.io, CC BY-SA 4.0).',
      },
      servers: [{ url: config.publicUrl }],
      tags: [
        { name: 'Lookup', description: 'IP address lookups.' },
        { name: 'System', description: 'Health and operations.' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'API key from the dashboard: `Authorization: Bearer ipx_...`',
          },
          apiKeyQuery: {
            type: 'apiKey',
            in: 'query',
            name: 'key',
            description: 'API key as a query parameter (for JSONP and quick tests).',
          },
        },
      },
    },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      return sendError(request, reply, error.statusCode, error.code, error.message);
    }
    if (error.validation) {
      return sendError(request, reply, 400, 'invalid_request', error.message);
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return sendError(
        request,
        reply,
        status,
        status === 404 ? 'not_found' : 'invalid_request',
        error.message,
      );
    }
    request.log.error({ err: error }, 'unhandled error');
    return sendError(request, reply, 500, 'internal_error', 'Internal server error');
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const shown = path.length > 100 ? `${path.slice(0, 100)}…` : path;
    return sendError(
      request,
      reply,
      404,
      'not_found',
      `Route ${request.method} ${shown} not found`,
    );
  });

  const routeOptions = { store, access: services };
  await app.register(lookupRoutes, { ...routeOptions, prefix: '/v1', documented: true });
  await app.register(lookupRoutes, { ...routeOptions, documented: false }); // ip-api-style aliases
  await app.register(batchRoutes, { ...routeOptions, prefix: '/v1' });
  await app.register(systemRoutes, { store, services });

  return app;
}
