import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const profileService = readFileSync(
  new URL('./profile-service.ts', import.meta.url),
  'utf8',
);

describe('Market data cache contract', () => {
  it('keeps Profile and Quote on independent cache keys', () => {
    expect(source).toContain('`quote:${symbol}`');
    expect(profileService).toContain('`profile:${symbol}`');
    expect(source).not.toMatch(/getQuote[\s\S]{0,300}cache\.clear/);
    expect(profileService).not.toMatch(/getCompanyProfile[\s\S]{0,500}cache\.clear/);
  });

  it('logs structured Profile cache metadata without logging the API key', () => {
    for (const field of [
      'symbol:',
      'providerUsed:',
      'fallbackReason:',
      'cacheState:',
      'cooldownUntil:',
      'errorCode:',
      'timestamp:',
    ]) {
      expect(profileService).toContain(field);
    }
    const logger = profileService.slice(
      profileService.indexOf('function logProfileResolution'),
      profileService.indexOf('export class CompanyProfileService'),
    );
    expect(logger).not.toContain('apiKey');
    expect(logger).not.toContain('providerKey');
  });
});
