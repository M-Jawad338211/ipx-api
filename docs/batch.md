---
title: Batch lookups
description: Look up to 100 addresses in one request.
---

`POST /v1/batch` takes up to 100 IPv4 or IPv6 addresses and returns one result per address, in the same order. It needs an API key, and every address counts as one lookup against your monthly quota.

```sh
curl -X POST "https://api.example.com/v1/batch?fields=ip,location.country_code" \
  -H "Authorization: Bearer ipx_your_key" \
  -H "Content-Type: application/json" \
  -d '{ "ips": ["8.8.8.8", "2001:4860:4860::8888", "not-an-ip"] }'
```

```json
{
  "success": true,
  "count": 3,
  "results": [
    { "success": true, "ip": "8.8.8.8", "location": { "country_code": "US" } },
    { "success": true, "ip": "2001:4860:4860::8888", "location": { "country_code": "US" } },
    {
      "success": false,
      "ip": "not-an-ip",
      "error": { "code": "invalid_ip", "message": "Not a valid IPv4 or IPv6 address" }
    }
  ]
}
```

- Each successful item has the same shape as a single lookup (see the [response reference](/docs/response)); `fields=` and `lang=` apply to every item.
- An invalid address does not fail the request: its item has `success: false` and the `invalid_ip` code.
- An empty list, more than 100 addresses or a body without `ips` returns `400 invalid_request`.
- Without a key the endpoint answers `401 unauthorized`.
