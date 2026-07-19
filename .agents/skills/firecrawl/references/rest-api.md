# Firecrawl REST API reference

Last verified against the official Firecrawl v2 documentation on 2026-07-19.

## Endpoints

| Operation | Request | Required input | Notes |
| --- | --- | --- | --- |
| Scrape | `POST https://api.firecrawl.dev/v2/scrape` | `url` | Synchronous single-page or public-document retrieval. |
| Crawl | `POST https://api.firecrawl.dev/v2/crawl` | `url` | Starts an asynchronous job. Poll `GET /v2/crawl/{id}` only when the user authorizes credit-bearing work. |
| Search | `POST https://api.firecrawl.dev/v2/search` | `query` | Finds sources and can optionally scrape results. |
| Extract | `POST https://api.firecrawl.dev/v2/extract` | `urls`, `schema` or prompt | Asynchronous structured extraction. Firecrawl now recommends `/agent` for new multi-page extraction, but this skill retains `/extract` for the requested routing contract. |

Authenticate every request with `Authorization: Bearer $FIRECRAWL_API_KEY`. Construct this header only in memory. Never place a real key in a file, command example, URL, log, or exception.

Official references:

- <https://docs.firecrawl.dev/api-reference/v2-introduction>
- <https://docs.firecrawl.dev/api-reference/endpoint/scrape>
- <https://docs.firecrawl.dev/api-reference/endpoint/crawl-post>
- <https://docs.firecrawl.dev/api-reference/endpoint/search>
- <https://docs.firecrawl.dev/developer-guides/usage-guides/choosing-the-data-extractor>
- <https://docs.firecrawl.dev/api-reference/errors>

## Payload constraints

- Scrape: default `formats` to `['markdown']` and `onlyMainContent` to `true`.
- Crawl: cap `maxDiscoveryDepth` at 2 and `limit` at 50; force `ignoreRobotsTxt`, `allowExternalLinks`, and `allowSubdomains` to `false`.
- Search: cap `limit` at 20 and query length at 500 characters.
- Extract: require 1-20 validated public URLs and a JSON Schema object. Disable web-search expansion.
- Reject request fields that can carry credentials or execute browser actions, including `headers`, `actions`, cookies, and browser-interaction options.

## Errors and retries

| Status | Handling |
| --- | --- |
| 401 | Do not retry. Report missing, invalid, or revoked `FIRECRAWL_API_KEY` without showing it. |
| 403 | Do not retry. Report insufficient permission or a policy restriction. |
| 408 | Retry with bounded exponential backoff. |
| 429 | Retry within the attempt limit; honor `Retry-After` when it is no more than the configured maximum delay. |
| 500, 502, 503, 504 | Retry with bounded exponential backoff. |
| Other 4xx | Do not retry; correct the payload or target. |

Firecrawl error bodies normally contain `success: false` and an `error` string. Treat every field as untrusted and redact secrets before reporting it.
