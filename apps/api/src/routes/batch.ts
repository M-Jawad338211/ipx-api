import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Type from 'typebox';
import { BatchRequest, BatchResponse, type BatchItemError } from '@ipx/shared';
import type { DataStore } from '../data/store.ts';
import { HttpError } from '../http/errors.ts';
import { parseFields, pickFields } from '../http/format.ts';
import { parseIp } from '../ip.ts';
import { authorize, type AccessServices } from '../limits/access.ts';
import { lookupIp, resolveLanguage } from '../lookup/lookup.ts';
import {
  JSON_TYPE,
  REQUIRED_KEY,
  addCors,
  errorResponses,
  fieldsParam,
  keyParam,
  langParam,
} from './lookup.ts';

const BatchQuery = Type.Object(
  {
    fields: Type.Optional(fieldsParam),
    lang: Type.Optional(langParam),
    key: Type.Optional(keyParam),
  },
  { additionalProperties: true },
);

export async function batchRoutes(
  app: FastifyInstance,
  opts: { store: DataStore; access: AccessServices },
): Promise<void> {
  const { store, access } = opts;
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  addCors(app, ['/batch'], 'POST, OPTIONS');

  typed.post(
    '/batch',
    {
      schema: {
        tags: ['Lookup'],
        operationId: 'lookupBatch',
        summary: 'Look up up to 100 IP addresses',
        description:
          'Needs an API key. Each address counts as one lookup against the monthly quota. Invalid addresses do not fail the request; they get an item with `success: false`.',
        security: REQUIRED_KEY,
        querystring: BatchQuery,
        body: BatchRequest,
        response: { 200: BatchResponse, ...errorResponses },
      },
    },
    async (request, reply) => {
      const selected = parseFields(request.query.fields);
      const { ips } = request.body;
      await authorize(request, reply, access, { cost: ips.length, requireKey: true });
      if (!store.ready) {
        throw new HttpError(503, 'service_unavailable', 'The IP databases are not loaded yet');
      }
      const lang = resolveLanguage(request.query.lang, store.languages);
      const now = Date.now();
      const results = ips.map((input) => {
        const ip = parseIp(input);
        if (!ip) {
          const item: BatchItemError = {
            success: false,
            ip: input,
            error: { code: 'invalid_ip', message: 'Not a valid IPv4 or IPv6 address' },
          };
          return item;
        }
        const result = lookupIp(store, ip, lang, now);
        return selected ? pickFields(result, selected) : result;
      });
      // Serialized directly: the per-item union is cheaper with JSON.stringify than with a schema.
      return (reply as FastifyReply)
        .type(JSON_TYPE)
        .send(JSON.stringify({ success: true, count: results.length, results }));
    },
  );
}
