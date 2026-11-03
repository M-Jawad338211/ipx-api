import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Type from 'typebox';
import { ApiError, IpLookup } from '@ipx/shared';
import type { DataStore } from '../data/store.ts';
import { clientIp, type TrustedProxy } from '../http/client-ip.ts';
import { HttpError } from '../http/errors.ts';
import { isValidCallback, jsonpBody, parseFields, pickFields } from '../http/format.ts';
import { parseIp } from '../ip.ts';
import { lookupIp, resolveLanguage } from '../lookup/lookup.ts';

export const JSON_TYPE = 'application/json; charset=utf-8';
export const JS_TYPE = 'application/javascript; charset=utf-8';

export interface LookupRouteOptions {
  store: DataStore;
  trustedProxy: TrustedProxy;
  /** false for the unprefixed ip-api-style aliases, which are left out of the OpenAPI document. */
  documented: boolean;
}

const LookupQuery = Type.Object(
  {
    fields: Type.Optional(
      Type.String({
        maxLength: 2000,
        description:
          'Comma-separated fields to return, e.g. `ip,location.country,security`. A group name (`location`) returns the whole group; `success` is always included.',
      }),
    ),
    lang: Type.Optional(
      Type.String({
        maxLength: 35,
        description:
          'Language for continent and country names: en (default), de, es, fr, ja, pt-BR, ru, zh-CN, fa, ko. Unknown values fall back to English. City and region names are English only.',
      }),
    ),
    callback: Type.Optional(
      Type.String({
        maxLength: 64,
        description:
          'JSONP callback name (letters, digits, `_`, `$`, `.`). The response becomes `callback({...});` and is always sent with HTTP 200, errors included.',
      }),
    ),
  },
  { additionalProperties: true },
);

const LookupParams = Type.Object({
  ip: Type.String({ description: 'IPv4 or IPv6 address to look up.', examples: ['8.8.8.8'] }),
});

const responses = {
  200: IpLookup,
  400: {
    ...ApiError,
    description: 'Invalid IP address (`invalid_ip`) or query parameter (`invalid_request`).',
  },
  503: { ...ApiError, description: 'The IP databases are not loaded (`service_unavailable`).' },
};

type LookupRequest = FastifyRequest<{ Querystring: Type.Static<typeof LookupQuery> }>;

function respond(request: LookupRequest, reply: FastifyReply, ipText: string, store: DataStore) {
  const { fields, lang, callback } = request.query;
  if (callback !== undefined && !isValidCallback(callback)) {
    throw new HttpError(
      400,
      'invalid_request',
      'callback must start with a letter, "_" or "$" and contain only letters, digits, "_", "$" and "." (max 64 characters)',
    );
  }
  const selected = parseFields(fields);
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
  const { store, trustedProxy, documented } = opts;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  // Anonymous GET lookups are meant to be callable from browsers on any origin.
  typed.addHook('onRequest', async (_request, reply) => {
    reply.header('access-control-allow-origin', '*');
  });

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
        querystring: LookupQuery,
        response: responses,
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const ip = clientIp(request.headers, request.socket.remoteAddress, trustedProxy);
      return respond(request, reply, ip, store);
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
        params: LookupParams,
        querystring: LookupQuery,
        response: responses,
      },
    },
    async (request, reply) => respond(request, reply, request.params.ip, store),
  );
}
