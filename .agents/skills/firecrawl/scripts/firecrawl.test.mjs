import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FirecrawlError,
  buildRequest,
  normalizeOutput,
  redactSecrets,
  requestWithRetry,
  validatePublicUrl,
} from './firecrawl.mjs';

const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }];

test('URL validation accepts public HTTP(S) and rejects unsafe URL forms', async () => {
  assert.equal(await validatePublicUrl('https://example.com/page', { lookup: publicLookup }), 'https://example.com/page');
  await assert.rejects(() => validatePublicUrl('file:///etc/passwd'), { code: 'INVALID_SCHEME' });
  await assert.rejects(() => validatePublicUrl('https://user:pass@example.com'), { code: 'URL_CREDENTIALS' });
  await assert.rejects(() => validatePublicUrl('http://localhost:3000'), { code: 'SSRF_BLOCKED' });
});

test('SSRF validation blocks private, loopback, link-local, and DNS-resolved private targets', async () => {
  for (const url of ['http://127.0.0.1', 'http://10.0.0.1', 'http://192.168.1.1', 'http://169.254.169.254', 'http://[::1]', 'http://[fe80::1]', 'http://[::ffff:7f00:1]']) {
    await assert.rejects(() => validatePublicUrl(url), { code: 'SSRF_BLOCKED' });
  }
  const privateLookup = async () => [{ address: '172.16.5.4', family: 4 }];
  await assert.rejects(() => validatePublicUrl('https://public-looking.example', { lookup: privateLookup }), { code: 'SSRF_BLOCKED' });
});

test('crawl validation enforces bounded depth, page count, and robots policy', async () => {
  const request = await buildRequest('crawl', { url: 'https://example.com' }, { lookup: publicLookup });
  assert.equal(request.payload.maxDiscoveryDepth, 2);
  assert.equal(request.payload.limit, 50);
  assert.equal(request.payload.ignoreRobotsTxt, false);
  assert.equal(request.payload.allowExternalLinks, false);
  await assert.rejects(
    () => buildRequest('crawl', { url: 'https://example.com', limit: 51 }, { lookup: publicLookup }),
    { code: 'CRAWL_LIMIT' },
  );
});

test('request timeout aborts mocked fetch without a live API call', async () => {
  const oldKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = 'offline-timeout-secret';
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  try {
    await assert.rejects(
      () => requestWithRetry('scrape', { url: 'https://example.com' }, { fetchImpl, timeoutMs: 10, maxRetries: 0 }),
      { code: 'TIMEOUT' },
    );
  } finally {
    if (oldKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldKey;
  }
});

test('429 honors bounded retry behavior and succeeds on a mocked second response', async () => {
  const oldKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = 'offline-rate-limit-secret';
  let calls = 0;
  const delays = [];
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      });
    }
    return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await requestWithRetry('search', { query: 'test' }, {
      fetchImpl,
      maxRetries: 1,
      sleep: async (ms) => { delays.push(ms); },
      random: () => 0,
    });
    assert.equal(result.success, true);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [0]);
  } finally {
    if (oldKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldKey;
  }
});

test('401 errors and generic redaction never leak the API key or bearer token', async () => {
  const oldKey = process.env.FIRECRAWL_API_KEY;
  const secret = 'fc-offline-super-secret-value';
  process.env.FIRECRAWL_API_KEY = secret;
  const fetchImpl = async () => new Response(JSON.stringify({
    success: false,
    error: `Invalid token ${secret} Authorization: Bearer ${secret}`,
  }), { status: 401, headers: { 'content-type': 'application/json' } });
  try {
    let caught;
    try {
      await requestWithRetry('scrape', { url: 'https://example.com' }, { fetchImpl, maxRetries: 2 });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof FirecrawlError);
    assert.equal(caught.status, 401);
    const serialized = JSON.stringify(redactSecrets({ message: caught.message, nested: secret }));
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(`Bearer ${secret}`), false);
    assert.match(serialized, /REDACTED|authentication failed/);
  } finally {
    if (oldKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldKey;
  }
});

test('403 is not retried while 5xx uses bounded retries', async () => {
  const oldKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = 'offline-status-secret';
  try {
    let forbiddenCalls = 0;
    await assert.rejects(
      () => requestWithRetry('scrape', {}, {
        fetchImpl: async () => {
          forbiddenCalls += 1;
          return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403 });
        },
        maxRetries: 2,
      }),
      { status: 403, retryable: false },
    );
    assert.equal(forbiddenCalls, 1);

    let serverCalls = 0;
    const result = await requestWithRetry('scrape', {}, {
      fetchImpl: async () => {
        serverCalls += 1;
        return new Response(JSON.stringify(serverCalls === 1
          ? { success: false, error: 'Unavailable' }
          : { success: true, data: {} }), { status: serverCalls === 1 ? 503 : 200 });
      },
      maxRetries: 1,
      sleep: async () => {},
      random: () => 0,
    });
    assert.equal(result.success, true);
    assert.equal(serverCalls, 2);
  } finally {
    if (oldKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldKey;
  }
});

test('response size is rejected before oversized content is processed', async () => {
  const oldKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = 'offline-size-secret';
  try {
    await assert.rejects(
      () => requestWithRetry('scrape', {}, {
        fetchImpl: async () => new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-length': '1000' },
        }),
        maxResponseBytes: 100,
      }),
      { code: 'RESPONSE_TOO_LARGE' },
    );
  } finally {
    if (oldKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldKey;
  }
});

test('normalized output always includes provenance and warning/error fields', () => {
  const output = normalizeOutput('scrape', { url: 'https://example.com/' }, {
    success: true,
    data: { metadata: { sourceURL: 'https://example.com/', title: 'Example' } },
  }, '2026-07-19T00:00:00.000Z');
  assert.deepEqual({
    source_url: output.source_url,
    title: output.title,
    retrieved_time: output.retrieved_time,
    warning: output.warning,
    error: output.error,
  }, {
    source_url: 'https://example.com/',
    title: 'Example',
    retrieved_time: '2026-07-19T00:00:00.000Z',
    warning: null,
    error: null,
  });
});
