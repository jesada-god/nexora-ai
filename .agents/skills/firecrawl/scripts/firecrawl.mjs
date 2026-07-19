#!/usr/bin/env node

import { lookup as dnsLookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

export const API_BASE = 'https://api.firecrawl.dev/v2';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_CRAWL_DEPTH = 2;
export const MAX_CRAWL_PAGES = 50;
export const MAX_SEARCH_RESULTS = 20;
export const MAX_EXTRACT_URLS = 20;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const BLOCKED_FIELDS = new Set([
  'actions',
  'cookies',
  'headers',
  'ignoreRobotsTxt',
  'skipTlsVerification',
]);

export class FirecrawlError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'FirecrawlError';
    this.code = options.code ?? 'FIRECRAWL_ERROR';
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

function ipv4Number(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

function inCidr4(value, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function mappedIpv4Address(address) {
  if (!address.startsWith('::ffff:')) return null;
  const tail = address.slice('::ffff:'.length);
  if (isIP(tail) === 4) return tail;
  const groups = tail.split(':');
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

export function isPublicIp(address) {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(normalized);
  if (version === 4) {
    const value = ipv4Number(normalized);
    const blocked = [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ];
    return !blocked.some(([base, bits]) => inCidr4(value, ipv4Number(base), bits));
  }
  if (version === 6) {
    if (normalized === '::' || normalized === '::1') return false;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
    if (/^fe[89ab]/.test(normalized)) return false;
    if (normalized.startsWith('ff')) return false;
    const mapped = mappedIpv4Address(normalized);
    return mapped ? isPublicIp(mapped) : true;
  }
  return false;
}

export async function validatePublicUrl(value, options = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new FirecrawlError('Target must be an absolute HTTP or HTTPS URL.', { code: 'INVALID_URL' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new FirecrawlError('Only HTTP and HTTPS target URLs are allowed.', { code: 'INVALID_SCHEME' });
  }
  if (parsed.username || parsed.password) {
    throw new FirecrawlError('Target URLs must not contain credentials.', { code: 'URL_CREDENTIALS' });
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new FirecrawlError('Localhost and local network names are blocked.', { code: 'SSRF_BLOCKED' });
  }

  let addresses;
  if (isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    const lookup = options.lookup ?? dnsLookup;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new FirecrawlError('Target hostname could not be resolved.', { code: 'DNS_ERROR' });
    }
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new FirecrawlError('Target resolves to a non-public address and was blocked.', { code: 'SSRF_BLOCKED' });
  }
  return parsed.toString();
}

function rejectBlockedFields(value, path = 'payload') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_FIELDS.has(key)) {
      throw new FirecrawlError(`${path}.${key} is blocked by the skill safety policy.`, { code: 'BLOCKED_OPTION' });
    }
    rejectBlockedFields(child, `${path}.${key}`);
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FirecrawlError(`${label} must be a JSON object.`, { code: 'INVALID_PAYLOAD' });
  }
}

export async function buildRequest(operation, input, options = {}) {
  assertPlainObject(input, 'Payload');
  rejectBlockedFields(input);

  if (operation === 'scrape') {
    const url = await validatePublicUrl(input.url, options);
    return {
      endpoint: 'scrape',
      payload: { ...input, url, formats: input.formats ?? ['markdown'], onlyMainContent: input.onlyMainContent ?? true },
    };
  }

  if (operation === 'crawl') {
    const url = await validatePublicUrl(input.url, options);
    const depth = input.maxDiscoveryDepth ?? MAX_CRAWL_DEPTH;
    const limit = input.limit ?? MAX_CRAWL_PAGES;
    if (!Number.isInteger(depth) || depth < 0 || depth > MAX_CRAWL_DEPTH) {
      throw new FirecrawlError(`maxDiscoveryDepth must be between 0 and ${MAX_CRAWL_DEPTH}.`, { code: 'CRAWL_LIMIT' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CRAWL_PAGES) {
      throw new FirecrawlError(`limit must be between 1 and ${MAX_CRAWL_PAGES}.`, { code: 'CRAWL_LIMIT' });
    }
    return {
      endpoint: 'crawl',
      payload: {
        ...input,
        url,
        maxDiscoveryDepth: depth,
        limit,
        allowExternalLinks: false,
        allowSubdomains: false,
        ignoreRobotsTxt: false,
      },
    };
  }

  if (operation === 'search') {
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500) {
      throw new FirecrawlError('Search query must contain 1-500 characters.', { code: 'INVALID_QUERY' });
    }
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_RESULTS) {
      throw new FirecrawlError(`Search limit must be between 1 and ${MAX_SEARCH_RESULTS}.`, { code: 'SEARCH_LIMIT' });
    }
    return { endpoint: 'search', payload: { ...input, query: input.query.trim(), limit } };
  }

  if (operation === 'extract') {
    if (!Array.isArray(input.urls) || input.urls.length < 1 || input.urls.length > MAX_EXTRACT_URLS) {
      throw new FirecrawlError(`Extract requires 1-${MAX_EXTRACT_URLS} URLs.`, { code: 'EXTRACT_LIMIT' });
    }
    assertPlainObject(input.schema, 'schema');
    const urls = [];
    for (const url of input.urls) urls.push(await validatePublicUrl(url, options));
    return { endpoint: 'extract', payload: { ...input, urls, enableWebSearch: false } };
  }

  throw new FirecrawlError('Operation must be scrape, crawl, search, or extract.', { code: 'INVALID_OPERATION' });
}

export function redactSecrets(value, secrets = []) {
  const secretValues = [process.env.FIRECRAWL_API_KEY, ...secrets].filter(Boolean);
  const redactString = (text) => {
    let result = String(text).replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]');
    for (const secret of secretValues) result = result.split(secret).join('[REDACTED]');
    return result;
  };
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secretValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactSecrets(child, secretValues)]));
  }
  return value;
}

async function readJsonLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new FirecrawlError(`Response exceeds the ${maxBytes}-byte limit.`, { code: 'RESPONSE_TOO_LARGE' });
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FirecrawlError(`Response exceeds the ${maxBytes}-byte limit.`, { code: 'RESPONSE_TOO_LARGE' });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new FirecrawlError('Firecrawl returned invalid JSON.', { code: 'INVALID_RESPONSE' });
  }
}

function retryDelayMs(response, attempt, random) {
  if (response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(500 * 2 ** attempt + Math.floor(random() * 250), 5_000);
}

export async function requestWithRetry(endpoint, payload, options = {}) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new FirecrawlError('FIRECRAWL_API_KEY is not set.', { code: 'MISSING_API_KEY' });
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw new FirecrawlError(`Firecrawl request timed out after ${timeoutMs}ms.`, { code: 'TIMEOUT', retryable: false });
      }
      throw new FirecrawlError(`Firecrawl network request failed: ${redactSecrets(error?.message ?? error)}`, { code: 'NETWORK_ERROR' });
    } finally {
      clearTimeout(timer);
    }

    const body = redactSecrets(await readJsonLimited(response, maxResponseBytes), [apiKey]);
    if (response.ok) return body;

    const retryable = RETRYABLE_STATUSES.has(response.status);
    if (retryable && attempt < maxRetries) {
      await sleep(retryDelayMs(response, attempt, random));
      continue;
    }

    const safeApiMessage = typeof body?.error === 'string' ? `: ${body.error}` : '';
    const messages = {
      401: 'Firecrawl authentication failed; check FIRECRAWL_API_KEY.',
      403: 'Firecrawl denied the request due to permission or policy.',
      429: 'Firecrawl rate limit remained active after bounded retries.',
    };
    throw new FirecrawlError(redactSecrets(messages[response.status] ?? `Firecrawl returned HTTP ${response.status}${safeApiMessage}`, [apiKey]), {
      code: `HTTP_${response.status}`,
      status: response.status,
      retryable,
    });
  }
  throw new FirecrawlError('Firecrawl request failed.', { code: 'UNREACHABLE' });
}

function sourceRecord(item, retrievedTime) {
  const metadata = item?.metadata ?? {};
  return {
    source_url: metadata.sourceURL ?? metadata.url ?? item?.url ?? null,
    title: metadata.title ?? item?.title ?? null,
    retrieved_time: retrievedTime,
    warning: item?.warning ?? null,
    error: metadata.error ?? item?.error ?? null,
  };
}

export function normalizeOutput(operation, payload, response, retrievedTime = new Date().toISOString()) {
  const safeResponse = redactSecrets(response);
  let sources = [];
  if (operation === 'search') {
    const groups = safeResponse?.data && typeof safeResponse.data === 'object' ? Object.values(safeResponse.data) : [];
    sources = groups.flatMap((group) => Array.isArray(group) ? group.map((item) => sourceRecord(item, retrievedTime)) : []);
  } else if (operation === 'extract') {
    sources = payload.urls.map((url) => ({ source_url: url, title: null, retrieved_time: retrievedTime, warning: null, error: null }));
  }
  const item = operation === 'scrape' ? safeResponse?.data : null;
  const primary = item ? sourceRecord(item, retrievedTime) : {
    source_url: payload.url ?? (payload.urls?.length === 1 ? payload.urls[0] : null),
    title: null,
    retrieved_time: retrievedTime,
    warning: null,
    error: null,
  };
  const asyncWarning = ['crawl', 'extract'].includes(operation) && safeResponse?.id
    ? `${operation} job started; response is not final until the job is polled.`
    : null;
  return redactSecrets({
    operation,
    source_url: primary.source_url,
    title: primary.title,
    retrieved_time: retrievedTime,
    warning: safeResponse?.warning ?? primary.warning ?? asyncWarning,
    error: primary.error,
    sources,
    data: safeResponse,
  });
}

export async function runFirecrawl(operation, input, options = {}) {
  const request = await buildRequest(operation, input, options);
  const response = await requestWithRetry(request.endpoint, request.payload, options);
  return normalizeOutput(operation, request.payload, response);
}

async function readInput(inputPath) {
  const text = inputPath === '-'
    ? await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
      })
    : await readFile(inputPath, 'utf8');
  return JSON.parse(text);
}

async function main() {
  const [operation, inputPath] = process.argv.slice(2);
  if (!operation || !inputPath) {
    throw new FirecrawlError('Usage: firecrawl.mjs <scrape|crawl|search|extract> <payload.json|->', { code: 'USAGE' });
  }
  const result = await runFirecrawl(operation, await readInput(inputPath));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safe = redactSecrets({
      operation: process.argv[2] ?? null,
      source_url: null,
      title: null,
      retrieved_time: new Date().toISOString(),
      warning: null,
      error: { code: error.code ?? 'ERROR', status: error.status ?? null, message: error.message },
      data: null,
    });
    process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
    process.exitCode = 1;
  });
}
