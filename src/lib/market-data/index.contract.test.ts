import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('Market data cache contract', () => {
  it('keeps Profile and Quote on independent cache keys', () => {
    expect(source).toContain('`quote:${symbol}`');
    expect(source).toContain('`profile:${symbol}`');
    expect(source).not.toMatch(/getQuote[\s\S]{0,300}cache\.clear/);
    expect(source).not.toMatch(/getCompanyProfile[\s\S]{0,500}cache\.clear/);
  });

  it('logs structured Profile cache metadata without logging the API key', () => {
    for (const field of [
      'symbol:',
      'provider:',
      'cache:',
      'cacheState:',
      'errorCode:',
      'retryable:',
      'timestamp:',
    ]) {
      expect(source).toContain(field);
    }
    const logger = source.slice(
      source.indexOf('function logProfileCache'),
      source.indexOf('class CachedMarketDataProvider'),
    );
    expect(logger).not.toContain('apiKey');
    expect(logger).not.toContain('providerKey');
  });
});
