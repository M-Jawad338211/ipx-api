/**
 * Response schema for the IP lookup API (v1) — the single source of truth.
 *
 * Fastify uses these schemas for serialization, @fastify/swagger turns them into openapi.json,
 * and docs/response.md documents every field. Once Phase 1 is accepted this shape is frozen:
 * fields may be added, but never removed, renamed or retyped (that needs /v2/).
 */
import Type from 'typebox';

type JsonType = 'string' | 'number' | 'integer' | 'boolean';
type JsonValue<T extends JsonType> = T extends 'string'
  ? string
  : T extends 'boolean'
    ? boolean
    : number;

/** A value that is either `type` or null (`"type": ["string", "null"]` in OpenAPI 3.1). */
function nullable<T extends JsonType>(type: T, description: string, example: JsonValue<T> | null) {
  return Type.Unsafe<JsonValue<T> | null>({
    type: [type, 'null'],
    description,
    examples: [example],
  });
}

function stringEnum<const T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({ type: 'string', enum: [...values], description });
}

export const ERROR_CODES = [
  'invalid_ip',
  'invalid_request',
  'unauthorized',
  'not_found',
  'rate_limited',
  'service_unavailable',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const Location = Type.Object(
  {
    continent: nullable('string', 'Continent name, localized with `lang=`.', 'North America'),
    continent_code: nullable(
      'string',
      'Two-letter continent code: AF, AN, AS, EU, NA, OC or SA.',
      'NA',
    ),
    country: nullable('string', 'Country name, localized with `lang=`.', 'United States'),
    country_code: nullable('string', 'ISO 3166-1 alpha-2 country code.', 'US'),
    is_eu: nullable(
      'boolean',
      'Whether the country is a member state of the European Union.',
      false,
    ),
    region: nullable(
      'string',
      'First-level subdivision (state, province, region). English only.',
      'California',
    ),
    city: nullable('string', 'City name. English only.', 'Mountain View'),
    postal: nullable('string', 'Postal code. Always null with the free data sources.', null),
    latitude: nullable('number', 'Approximate latitude of the city (WGS 84).', 37.422),
    longitude: nullable('number', 'Approximate longitude of the city (WGS 84).', -122.085),
  },
  { additionalProperties: false, description: 'Where the IP address is registered or used.' },
);

export const TimeZone = Type.Object(
  {
    id: nullable('string', 'IANA time zone identifier.', 'America/Los_Angeles'),
    utc_offset: nullable('string', 'Current UTC offset as ±HH:MM.', '-08:00'),
    utc_offset_seconds: nullable('integer', 'Current UTC offset in seconds.', -28800),
    is_dst: nullable('boolean', 'Whether daylight saving time is in effect right now.', false),
    current_time: nullable(
      'string',
      'Current local time in ISO 8601 format with offset.',
      '2026-11-03T05:30:00-08:00',
    ),
  },
  { additionalProperties: false, description: 'Time zone at the location, computed per request.' },
);

export const Network = Type.Object(
  {
    asn: nullable('integer', 'Autonomous system number.', 15169),
    as_name: nullable('string', 'Name of the organization that operates the AS.', 'Google LLC'),
    as_domain: nullable('string', 'Primary domain of the AS operator.', 'google.com'),
  },
  { additionalProperties: false, description: 'The autonomous system that announces the IP.' },
);

export const Currency = Type.Object(
  {
    code: Type.String({ description: 'ISO 4217 currency code.', examples: ['USD'] }),
    name: nullable('string', 'Currency name in English.', 'United States dollar'),
    symbol: nullable('string', 'Currency symbol.', '$'),
  },
  { additionalProperties: false },
);

export const Language = Type.Object(
  {
    code: Type.String({ description: 'ISO 639-3 language code.', examples: ['eng'] }),
    name: Type.String({ description: 'Language name in English.', examples: ['English'] }),
  },
  { additionalProperties: false },
);

export const Locale = Type.Object(
  {
    flag: nullable('string', 'Country flag emoji.', '🇺🇸'),
    calling_code: nullable('string', 'International calling code.', '+1'),
    currency: Type.Union([Currency, Type.Null()], {
      description: 'Main currency of the country, or null when unknown.',
    }),
    languages: Type.Array(Language, {
      description: 'Official or main languages of the country; empty when unknown.',
    }),
  },
  { additionalProperties: false, description: 'Country facts derived from the country code.' },
);

export const Security = Type.Object(
  {
    is_tor: Type.Boolean({ description: 'Whether the IP is a current Tor exit node.' }),
    is_proxy: Type.Boolean({
      description:
        'Whether the IP is a known open or residential proxy. Always false with source "basic".',
    }),
    is_vpn: Type.Boolean({
      description: 'Whether the IP belongs to a VPN service. Always false with source "basic".',
    }),
    is_hosting: Type.Boolean({
      description: 'Whether the IP is in a published cloud or hosting provider range.',
    }),
    hosting_provider: nullable(
      'string',
      'Provider whose published ranges contain the IP.',
      'Google',
    ),
    source: stringEnum(
      ['basic'] as const,
      'Which security dataset produced these flags. "basic" = public Tor and cloud lists only.',
    ),
  },
  { additionalProperties: false, description: 'Risk signals merged from public IP lists.' },
);

export const IpLookup = Type.Object(
  {
    success: Type.Literal(true, { description: 'Always true for a successful lookup.' }),
    ip: Type.String({
      description: 'The IP address, normalized (IPv6 compressed, IPv4-mapped IPv6 as IPv4).',
      examples: ['8.8.8.8'],
    }),
    type: stringEnum(['ipv4', 'ipv6'] as const, 'IP version.'),
    reserved: Type.Boolean({
      description:
        'True for private, loopback, link-local, multicast, documentation and other reserved ranges. Location, network and locale fields are then null.',
    }),
    location: Location,
    timezone: TimeZone,
    network: Network,
    locale: Locale,
    security: Security,
  },
  { additionalProperties: false, description: 'Lookup result for one IP address.' },
);

export const ApiError = Type.Object(
  {
    success: Type.Literal(false),
    error: Type.Object(
      {
        code: stringEnum(ERROR_CODES, 'Machine-readable error code.'),
        message: Type.String({ description: 'Human-readable explanation.' }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false, description: 'Error response.' },
);

const DatabaseStatus = Type.Object({
  loaded: Type.Boolean(),
  file: Type.String(),
  database_type: nullable('string', 'Type string from the mmdb metadata.', 'DBIP-City-Lite'),
  build_date: nullable('string', 'Build date from the mmdb metadata (ISO 8601).', null),
  age_days: nullable('number', 'Days since the database was built.', 2.4),
  loaded_at: nullable('string', 'When this process loaded the file (ISO 8601).', null),
  error: nullable('string', 'Last load error, if any.', null),
});

const ListStatus = Type.Object({
  loaded: Type.Boolean(),
  file: Type.String(),
  entries: Type.Integer(),
  updated_at: nullable('string', 'When the list was downloaded (ISO 8601).', null),
  age_hours: nullable('number', 'Hours since the list was downloaded.', 1.5),
  error: nullable('string', 'Last load error, if any.', null),
});

export const Health = Type.Object(
  {
    status: stringEnum(
      ['ok', 'degraded'] as const,
      '"degraded" when an IP database is missing or failed to load.',
    ),
    uptime_seconds: Type.Number(),
    memory_rss_mb: Type.Number(),
    databases: Type.Object({ city: DatabaseStatus, asn: DatabaseStatus }),
    lists: Type.Object({ tor: ListStatus, hosting: ListStatus }),
    countries: Type.Integer({ description: 'Countries in the enrichment table.' }),
  },
  { description: 'Service health and data freshness.' },
);

export type IpLookup = Type.Static<typeof IpLookup>;
export type Location = Type.Static<typeof Location>;
export type TimeZone = Type.Static<typeof TimeZone>;
export type Network = Type.Static<typeof Network>;
export type Locale = Type.Static<typeof Locale>;
export type Security = Type.Static<typeof Security>;
export type ApiError = Type.Static<typeof ApiError>;
export type Health = Type.Static<typeof Health>;

/**
 * Every selectable path for `fields=`, in schema order: top-level fields, group names
 * (`location`) and nested fields (`location.city`, `locale.currency.code`).
 */
export const IP_LOOKUP_FIELDS: readonly string[] = collectPaths(IpLookup);

/** Leaf paths only (no group names) — every one of these must be documented. */
export const IP_LOOKUP_LEAF_FIELDS: readonly string[] = IP_LOOKUP_FIELDS.filter(
  (field) => !IP_LOOKUP_FIELDS.some((other) => other.startsWith(`${field}.`)),
);

interface SchemaNode {
  properties?: Record<string, SchemaNode>;
  anyOf?: SchemaNode[];
}

function collectPaths(schema: object, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, child] of Object.entries((schema as SchemaNode).properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    const objectBranch = child.properties ? child : child.anyOf?.find((s) => s.properties);
    if (objectBranch) paths.push(...collectPaths(objectBranch, path));
  }
  return paths;
}
