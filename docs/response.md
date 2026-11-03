---
title: Response reference
description: Every field the IP lookup API returns, where it comes from and when it is null.
---

# Response reference

This page documents version 1 of the response (`/v1/...`). The shape is frozen: new fields may be added over time, but existing fields are never removed, renamed or given a different type. Breaking changes would ship under `/v2/`.

## Endpoints

| Method | Path            | Description                                                               |
| ------ | --------------- | ------------------------------------------------------------------------- |
| GET    | `/v1/json`      | Look up the caller's own IP address. Sent with `Cache-Control: no-store`. |
| GET    | `/v1/json/{ip}` | Look up any IPv4 or IPv6 address.                                         |
| GET    | `/health`       | Service health and data freshness (HTTP 503 when a database is missing).  |
| GET    | `/openapi.json` | OpenAPI 3.1 description of the API.                                       |

`/json` and `/json/{ip}` (without `/v1`) are aliases kept for compatibility with ip-api-style clients. They return exactly the same responses. A trailing slash is accepted on every path.

Lookup responses carry `Access-Control-Allow-Origin: *`, so they can be called from any website.

## Query parameters

| Parameter  | Example                               | Description                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`   | `fields=ip,location.country,security` | Comma-separated list of fields to return. A group name (`location`) returns the whole group; a dotted path (`location.city`, `locale.currency.code`) returns one field. `success` is always included. Unknown names return `400 invalid_request`.                                                                                                           |
| `lang`     | `lang=de`                             | Language for the `location.continent` and `location.country` names: `en` (default), `de`, `es`, `fr`, `ja`, `pt-BR`, `ru`, `zh-CN`, `fa`, `ko`. Matching ignores case, and a base code picks its only variant (`pt` means `pt-BR`, `zh` means `zh-CN`). Unknown languages fall back to English. City and region names are always English.                   |
| `callback` | `callback=handleIp`                   | Returns JSONP: `/**/ typeof handleIp === 'function' && handleIp({...});` with `Content-Type: application/javascript`. The name must start with a letter, `_` or `$` and may contain letters, digits, `_`, `$` and `.` (64 characters at most). JSONP responses always use HTTP 200, errors included, because browsers hide the body of failed script loads. |

## Example

`GET /v1/json/8.8.8.8`

```json
{
  "success": true,
  "ip": "8.8.8.8",
  "type": "ipv4",
  "reserved": false,
  "location": {
    "continent": "North America",
    "continent_code": "NA",
    "country": "United States",
    "country_code": "US",
    "is_eu": false,
    "region": "California",
    "city": "Mountain View",
    "postal": null,
    "latitude": 37.422,
    "longitude": -122.085
  },
  "timezone": {
    "id": "America/Los_Angeles",
    "utc_offset": "-08:00",
    "utc_offset_seconds": -28800,
    "is_dst": false,
    "current_time": "2026-11-03T05:37:08-08:00"
  },
  "network": {
    "asn": 15169,
    "as_name": "Google LLC",
    "as_domain": "google.com"
  },
  "locale": {
    "flag": "🇺🇸",
    "calling_code": "+1",
    "currency": { "code": "USD", "name": "United States dollar", "symbol": "$" },
    "languages": [{ "code": "eng", "name": "English" }]
  },
  "security": {
    "is_tor": false,
    "is_proxy": false,
    "is_vpn": false,
    "is_hosting": true,
    "hosting_provider": "Google",
    "source": "basic"
  }
}
```

## Fields

Every field is always present in a full response. A value is `null` when the data sources have nothing for the address; the "Null when" column says when that happens.

### Top level

| Field      | Type    | Description                                                                                                                                                                                                                                                                                                         | Null when |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `success`  | boolean | Always `true` for a lookup. Errors have `success: false` (see [Errors](#errors)).                                                                                                                                                                                                                                   | never     |
| `ip`       | string  | The address looked up, normalized: IPv6 in compressed lowercase form (RFC 5952), IPv4-mapped IPv6 (`::ffff:8.8.8.8`) as plain IPv4.                                                                                                                                                                                 | never     |
| `type`     | string  | `ipv4` or `ipv6`.                                                                                                                                                                                                                                                                                                   | never     |
| `reserved` | boolean | `true` for private, loopback, link-local, CGNAT, multicast, documentation, benchmarking and other special-purpose ranges, and for IPv6 outside global unicast `2000::/3`. Reserved addresses still return HTTP 200; their location, time zone, network and locale fields are null and the security flags are false. | never     |
| `location` | object  | Where the address is registered or used.                                                                                                                                                                                                                                                                            | never     |
| `timezone` | object  | The time zone at that location, computed at request time.                                                                                                                                                                                                                                                           | never     |
| `network`  | object  | The autonomous system announcing the address.                                                                                                                                                                                                                                                                       | never     |
| `locale`   | object  | Facts about the country.                                                                                                                                                                                                                                                                                            | never     |
| `security` | object  | Risk signals from public lists.                                                                                                                                                                                                                                                                                     | never     |

### `location`

| Field                     | Type    | Description                                                                                             | Source                                 | Null when                                       |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| `location.continent`      | string  | Continent name, localized with `lang`.                                                                  | IPinfo Lite, DB-IP for other languages | no data                                         |
| `location.continent_code` | string  | `AF`, `AN`, `AS`, `EU`, `NA`, `OC` or `SA`.                                                             | IPinfo Lite                            | no data                                         |
| `location.country`        | string  | Country name, localized with `lang`.                                                                    | IPinfo Lite, DB-IP for other languages | no data                                         |
| `location.country_code`   | string  | ISO 3166-1 alpha-2 code.                                                                                | IPinfo Lite (DB-IP if IPinfo has none) | no data                                         |
| `location.is_eu`          | boolean | Whether the country is one of the 27 EU member states.                                                  | built-in list                          | no country                                      |
| `location.region`         | string  | First-level subdivision (state, province). English only.                                                | DB-IP City Lite                        | no data, or the sources disagree on the country |
| `location.city`           | string  | City name. English only.                                                                                | DB-IP City Lite                        | no data, or the sources disagree on the country |
| `location.postal`         | string  | Postal code.                                                                                            | none yet                               | always null on the free data sources            |
| `location.latitude`       | number  | Approximate latitude of the city (WGS 84). This is a city-level estimate, not the position of a device. | DB-IP City Lite                        | no data, or the sources disagree on the country |
| `location.longitude`      | number  | Approximate longitude of the city (WGS 84).                                                             | DB-IP City Lite                        | no data, or the sources disagree on the country |

**Country rule.** Country and ASN always come from IPinfo Lite. City, region and coordinates come from DB-IP City Lite, but only when DB-IP reports the same country as IPinfo. When the two disagree, those fields are null rather than mixing two countries in one answer.

### `timezone`

| Field                         | Type    | Description                                                                                                                                                                            | Null when                                                      |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `timezone.id`                 | string  | IANA time zone, e.g. `Asia/Karachi`. Found from the coordinates (timezone-boundary-builder data via geo-tz); without coordinates, the country's zone when the country has exactly one. | no coordinates and the country has several zones (US, RU, ...) |
| `timezone.utc_offset`         | string  | Current offset as `+HH:MM` or `-HH:MM`.                                                                                                                                                | `timezone.id` is null                                          |
| `timezone.utc_offset_seconds` | integer | Current offset in seconds (`-28800` for UTC-8).                                                                                                                                        | `timezone.id` is null                                          |
| `timezone.is_dst`             | boolean | Whether daylight saving time is in effect right now.                                                                                                                                   | `timezone.id` is null                                          |
| `timezone.current_time`       | string  | Current local time, ISO 8601 with offset, to the second.                                                                                                                               | `timezone.id` is null                                          |

### `network`

| Field               | Type    | Description                             | Null when |
| ------------------- | ------- | --------------------------------------- | --------- |
| `network.asn`       | integer | Autonomous system number, e.g. `15169`. | no data   |
| `network.as_name`   | string  | Organization that operates the AS.      | no data   |
| `network.as_domain` | string  | Main domain of the AS operator.         | no data   |

Source: IPinfo Lite.

### `locale`

| Field                    | Type   | Description                                                                                     | Null when                                          |
| ------------------------ | ------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `locale.flag`            | string | Country flag emoji.                                                                             | no country                                         |
| `locale.calling_code`    | string | International calling code, e.g. `+92`.                                                         | no country, or the territory has none (Antarctica) |
| `locale.currency`        | object | Main currency of the country.                                                                   | no country, or no currency                         |
| `locale.currency.code`   | string | ISO 4217 code, e.g. `PKR`.                                                                      | (the object is null instead)                       |
| `locale.currency.name`   | string | Currency name in English.                                                                       | unknown                                            |
| `locale.currency.symbol` | string | Currency symbol.                                                                                | unknown                                            |
| `locale.languages`       | array  | Official or main languages, each `{ "code": "eng", "name": "English" }` with an ISO 639-3 code. | never null; empty when unknown                     |

Source: [mledoze/countries](https://github.com/mledoze/countries) (ODbL-1.0), looked up by `location.country_code`.

### `security`

| Field                       | Type           | Description                                                                                                                          |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `security.is_tor`           | boolean        | The address is a current Tor exit node (Tor Project exit list, refreshed hourly).                                                    |
| `security.is_proxy`         | boolean        | The address is a known open or residential proxy. Always `false` while `source` is `basic`.                                          |
| `security.is_vpn`           | boolean        | The address belongs to a VPN service. Always `false` while `source` is `basic`.                                                      |
| `security.is_hosting`       | boolean        | The address is in a range published by a cloud or hosting provider.                                                                  |
| `security.hosting_provider` | string or null | Which provider: `AWS`, `Google`, `Google Cloud`, `Microsoft Azure`, `Cloudflare` or `DigitalOcean`. Null when `is_hosting` is false. |
| `security.source`           | string         | Dataset behind these flags. `basic` = the public Tor and cloud lists only. A paid VPN/proxy dataset will report a different value.   |

Hosting ranges come from the providers' own published lists, refreshed daily. Datacenters that publish no list (for example Hetzner or OVH) are not detected yet.

## Errors

Errors use HTTP status codes and this shape:

```json
{
  "success": false,
  "error": { "code": "invalid_ip", "message": "\"foo\" is not a valid IPv4 or IPv6 address" }
}
```

| Code                  | HTTP status | When                                                                                            |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `invalid_ip`          | 400         | The address in the URL is not a valid IPv4 or IPv6 address.                                     |
| `invalid_request`     | 400         | A query parameter is invalid: unknown name in `fields`, unsafe `callback` name, value too long. |
| `unauthorized`        | 401         | The API key is missing, unknown or revoked (keyed endpoints).                                   |
| `not_found`           | 404         | No such route.                                                                                  |
| `rate_limited`        | 429         | Too many requests; see the `Retry-After` header.                                                |
| `service_unavailable` | 503         | The IP databases are not loaded (for example during first start-up).                            |
| `internal_error`      | 500         | Unexpected server error.                                                                        |

Reserved and private addresses are not errors: they return HTTP 200 with `reserved: true`.

## Data sources and credits

- IP geolocation: [DB-IP](https://db-ip.com) City Lite, CC BY 4.0, updated monthly.
- Country and ASN: [IPinfo](https://ipinfo.io) Lite, CC BY-SA 4.0, updated daily.
- Tor exits: [The Tor Project](https://check.torproject.org/exit-addresses).
- Hosting ranges: published lists from AWS, Google, Google Cloud, Microsoft Azure, Cloudflare and DigitalOcean.
- Country facts: [mledoze/countries](https://github.com/mledoze/countries), ODbL-1.0; time zones per country from the IANA tz database.
- Time zone boundaries: [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) via [geo-tz](https://github.com/evansiroky/node-geo-tz).

Geolocation is approximate. Do not use it for legal, emergency or compliance decisions.
