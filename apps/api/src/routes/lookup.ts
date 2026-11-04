import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Type from 'typebox';
import { ApiError, IpLookup } from '@ipx/shared';
import type { DataStore } from '../data/store.ts';
import { clientIp } from '../http/client-ip.ts';
import { HttpError } from '../http/errors.ts';
import { isValidCallback, jsonpBody, parseFields, pickFields } from '../http/format.ts';
import { parseIp } from '../ip.ts';
import { authorize, type AccessServices } from '../limits/access.ts';
import { lookupIp, resolveLanguage } from '../lookup/lookup.ts';

export const JSON_TYPE = 'application/json; charset=utf-8';
export const JS_TYPE = 'application/javascript; charset=utf-8';

export interface LookupRouteOptions {
  store: DataStore;
  access: AccessServices;
  /** false for the unprefixed ip-api-style aliases, which are left out of the OpenAPI document. */
  documented: boolean;
}

export const fieldsParam = Type.String({
  maxLength: 2000,
  description:
    'Comma-separated fields to return, e.g. `ip,location.country,security`. A group name (`location`) returns the whole group; `success` is always included.',
});

export const langParam = Type.String({
  maxLength: 35,
  description:
    'Language for continent and country names: en (default), de, es, fr, ja, pt-BR, ru, zh-CN, fa, ko. Unknown values fall back to English. City and region names are English only.',
});

export const keyParam = Type.String({
  maxLength: 100,
  description:
    'API key. Prefer the `Authorization: Bearer` header; the query parameter exists for JSONP and quick tests.',
});

const LookupQuery = Type.Object(
  {
    fields: Type.Optional(fieldsParam),
    lang: Type.Optional(langParam),
    callback: Type.Optional(
      Type.String({
        maxLength: 64,
        description:
          'JSONP callback name (letters, digits, `_`, `$`, `.`). The response becomes `callback({...});` and is always sent with HTTP 200, errors included.',
      }),
    ),
    key: Type.Optional(keyParam),
  },
  { additionalProperties: true },
);

const LookupParams = Type.Object({
  ip: Type.String({ description: 'IPv4 or IPv6 address to look up.', examples: ['8.8.8.8'] }),
});

export const errorResponses = {
  400: {
    ...ApiError,
    description: 'Invalid IP address (`invalid_ip`) or request (`invalid_request`).',
  },
  401: {
    ...ApiError,
    description: 'Missing, invalid or revoked API key, or unconfirmed email (`unauthorized`).',
  },
  429: {
    ...ApiError,
    description:
      'Rate limit or monthly quota reached (`rate_limited`). See `Retry-After` and `X-RateLimit-*`.',
  },
  503: {
    ...ApiError,
    description: 'IP databases not loaded or API keys cannot be checked (`service_unavailable`).',
  },
};

/** No key needed; a key raises the limits. */
type SecurityRequirement = Record<string, string[]>;
export const OPTIONAL_KEY: SecurityRequirement[] = [{}, { apiKeyQuery: [] }, { bearerAuth: [] }];
export const REQUIRED_KEY: SecurityRequirement[] = [{ apiKeyQuery: [] }, { bearerAuth: [] }];

export const CORS_EXPOSED_HEADERS =
  'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After';

/** Lookups are callable from browsers on any origin (with an Authorization header too). */
export function addCors(app: FastifyInstance, paths: string[], methods: string): void {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-expose-headers', CORS_EXPOSED_HEADERS);
  });
  for (const path of paths) {
    app.options(path, { schema: { hide: true } }, async (_request, reply) => {
      reply
        .code(204)
        .header('access-control-allow-methods', methods)
        .header('access-control-allow-headers', 'Authorization, Content-Type')
        .header('access-control-max-age', '86400');
    });
  }
}

export function checkCallback(callback: string | undefined): void {
  if (callback !== undefined && !isValidCallback(callback)) {
    throw new HttpError(
      400,
      'invalid_request',
      'callback must start with a letter, "_" or "$" and contain only letters, digits, "_", "$" and "." (max 64 characters)',
    );
  }
}

type LookupRequest = FastifyRequest<{ Querystring: Type.Static<typeof LookupQuery> }>;

async function respond(
  request: LookupRequest,
  reply: FastifyReply,
  ipText: string,
  { store, access }: LookupRouteOptions,
) {
  const { fields, lang, callback } = request.query;
  checkCallback(callback);
  const selected = parseFields(fields);
  await authorize(request, reply, access, { cost: 1, requireKey: false });
  if (!store.ready) {
    throw new HttpError(503, 'service_unavailable', 'The IP databases are not loaded yet');
  }
  const ip = parseIp(ipText);
  if (!ip) {
    const shown = ipText.length > 64 ? `${ipText.slice(0, 64)}…` : ipText;
    throw new HttpError(400, 'invalid_ip', `"${shown}" is not a valid IPv4 or IPv6 address`);
  }

  const result = lookupIp(store, ip, resolveLanguage(lang, store.languages));
  const body = selected ? pickFields(result, selected) : result;
  if (callback) {
    return reply
      .type(JS_TYPE)
      .header('x-content-type-options', 'nosniff')
      .send(jsonpBody(callback, body));
  }
  if (selected) return reply.type(JSON_TYPE).send(JSON.stringify(body));
  return reply.send(result); // serialized by the response schema (fast-json-stringify)
}

export async function lookupRoutes(app: FastifyInstance, opts: LookupRouteOptions): Promise<void> {
  const { documented } = opts;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  addCors(app, ['/json', '/json/:ip'], 'GET, OPTIONS');

  typed.get(
    '/json',
    {
      config: { jsonp: true },
      schema: {
        hide: !documented,
        tags: ['Lookup'],
        operationId: 'lookupCaller',
        summary: "Look up the caller's IP address",
        description:
          'Returns the lookup result for the IP address the request comes from. Responses are marked `Cache-Control: no-store` because they depend on the caller.',
        security: OPTIONAL_KEY,
        querystring: LookupQuery,
        response: { 200: IpLookup, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const ip = clientIp(
        request.headers,
        request.socket.remoteAddress,
        opts.access.config.trustedProxy,
      );
      return respond(request, reply, ip, opts);
    },
  );

  typed.get(
    '/json/:ip',
    {
      config: { jsonp: true },
      schema: {
        hide: !documented,
        tags: ['Lookup'],
        operationId: 'lookupIp',
        summary: 'Look up an IP address',
        description:
          'Returns geolocation, network, time zone, locale and security data for one IPv4 or IPv6 address. Private and reserved addresses return HTTP 200 with `reserved: true`.',
        security: OPTIONAL_KEY,
        params: LookupParams,
        querystring: LookupQuery,
        response: { 200: IpLookup, ...errorResponses },
      },
    },
    async (request, reply) => respond(request, reply, request.params.ip, opts),
  );
}
