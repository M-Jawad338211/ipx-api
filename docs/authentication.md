---
title: API keys and limits
description: Anonymous limits, API keys, monthly quotas and the rate-limit headers.
---

## Without a key

Requests without a key are limited per client IP address (IPv6: per /64 network):

| Limit      | Value          |
| ---------- | -------------- |
| Per minute | 45 requests    |
| Per day    | 1,000 requests |

Batch lookups always need a key.

## With a key

Create keys in the [dashboard](/dashboard). A key is shown once when you create it; only its first characters are stored in readable form. Send it in a header (preferred) or as a query parameter:

```sh
curl -H "Authorization: Bearer ipx_your_key" https://api.example.com/v1/json/8.8.8.8
curl "https://api.example.com/v1/json/8.8.8.8?key=ipx_your_key"
```

Keys are not subject to the per-IP limits. Every lookup counts against the monthly quota of your account, shared by all its keys:

| Plan | Price     | Lookups per month |
| ---- | --------- | ----------------- |
| Free | $0        | 10,000            |
| Pro  | $20/month | 1,000,000         |

Quotas reset at the start of each calendar month (UTC). Usage appears in the dashboard within a minute or two. A revoked key stops working within a minute.

If email confirmation is enabled for the service, a key only works after you confirm your email address in the dashboard.

## Rate-limit headers

Every lookup response tells you where you stand:

| Header                  | Meaning                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `X-RateLimit-Limit`     | Requests allowed in the current window (per minute or per day without a key, per month with a key). |
| `X-RateLimit-Remaining` | Requests left in that window.                                                                       |
| `X-RateLimit-Reset`     | When the window resets, as a Unix timestamp in seconds.                                             |

When a limit is reached the API answers `429` with the `rate_limited` error code and a `Retry-After` header (seconds):

```json
{
  "success": false,
  "error": {
    "code": "rate_limited",
    "message": "Monthly quota of 10,000 lookups reached for the Free plan"
  }
}
```

## Key errors

| Status | Code                  | When                                                                               |
| ------ | --------------------- | ---------------------------------------------------------------------------------- |
| 401    | `unauthorized`        | The key is malformed, unknown or revoked, or the account's email is not confirmed. |
| 503    | `service_unavailable` | Keys cannot be checked right now; retry shortly.                                   |
