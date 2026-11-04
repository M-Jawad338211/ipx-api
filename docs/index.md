---
title: Quickstart
description: Look up any IPv4 or IPv6 address with one HTTP request.
---

The API returns location, network, time zone, locale and security data for an IP address as JSON. You can start without an account: anonymous requests are limited to 45 per minute and 1,000 per day per IP address.

## Your own IP

```sh
curl https://api.example.com/v1/json
```

## Any IP address

```sh
curl https://api.example.com/v1/json/8.8.8.8
```

```json
{
  "success": true,
  "ip": "8.8.8.8",
  "type": "ipv4",
  "reserved": false,
  "location": {
    "country": "United States",
    "country_code": "US",
    "city": "Mountain View",
    "...": "..."
  },
  "timezone": { "id": "America/Los_Angeles", "utc_offset": "-08:00", "...": "..." },
  "network": { "asn": 15169, "as_name": "Google LLC", "as_domain": "google.com" },
  "locale": { "flag": "🇺🇸", "calling_code": "+1", "...": "..." },
  "security": { "is_tor": false, "is_hosting": true, "hosting_provider": "Google", "...": "..." }
}
```

Every field is described in the [response reference](/docs/response).

## Only the fields you need

```sh
curl "https://api.example.com/v1/json/8.8.8.8?fields=ip,location.country_code,security"
```

## From a browser

Lookup responses allow any origin (CORS), so you can call the API directly from a web page:

```js
const res = await fetch('https://api.example.com/v1/json');
const data = await res.json();
console.log(data.location.country);
```

## With an API key

Create a free account and an API key in the [dashboard](/dashboard) for 10,000 lookups per month without the per-minute limit, then send it as a bearer token:

```sh
curl -H "Authorization: Bearer ipx_your_key" https://api.example.com/v1/json/8.8.8.8
```

See [API keys and limits](/docs/authentication) for plans, quotas and rate-limit headers.
