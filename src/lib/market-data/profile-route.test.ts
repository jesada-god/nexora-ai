import { describe, expect, it, vi } from 'vitest';
import { MarketDataError } from './errors';
import { companyProfileMarketDataResponse } from './route';
import type { CompanyProfileResult } from './profile-service';

vi.mock('server-only', () => ({}));

const resolved: CompanyProfileResult = {
  data: {
    symbol: 'RKLB',
    name: 'Rocket Lab USA, Inc.',
    description: 'Rocket Lab provides launch and space systems.',
    exchange: 'NASDAQ',
    currency: 'USD',
    country: 'US',
    sector: 'Industrials',
    industry: 'Aerospace & Defense',
    website: 'https://www.rocketlabusa.com/',
    marketCapitalization: 20_000_000_000,
    employees: null,
    fiscalYearEnd: null,
    latestQuarter: null,
  },
  provider: 'financial-modeling-prep',
  providerUsed: 'financial-modeling-prep',
  fallbackUsed: true,
  profileStatus: 'fresh',
  cachedAt: '2026-07-20T00:00:00.000Z',
  retryAfterSeconds: 60,
  reasonCode: 'PRIMARY_RATE_LIMITED',
  freshness: {
    status: 'cached',
    asOf: null,
    maxAgeSeconds: 86_400,
    cachedAt: '2026-07-20T00:00:00.000Z',
  },
};

describe('Company Profile API envelope', () => {
  it('returns the complete success envelope with HTTP 200', async () => {
    const response = await companyProfileMarketDataResponse(async () => resolved);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: { symbol: 'RKLB' },
      status: 'fresh',
      providerUsed: 'financial-modeling-prep',
      fallbackUsed: true,
      cachedAt: '2026-07-20T00:00:00.000Z',
      retryAfterSeconds: 60,
      reasonCode: 'PRIMARY_RATE_LIMITED',
      meta: {
        provider: 'financial-modeling-prep',
      },
    });
    for (const field of [
      'data',
      'status',
      'providerUsed',
      'fallbackUsed',
      'cachedAt',
      'retryAfterSeconds',
      'reasonCode',
    ]) {
      expect(body).toHaveProperty(field);
    }
  });

  it('returns 429 only when the terminal error is rate-limited', async () => {
    const response = await companyProfileMarketDataResponse(async () => {
      throw new MarketDataError(
        'rate-limited',
        'Both profile providers are rate-limited',
        20,
        undefined,
        {
          reason: 'PRIMARY_RATE_LIMITED; SECONDARY_RATE_LIMITED',
          primaryReason: 'PRIMARY_RATE_LIMITED',
          fallbackReason: 'SECONDARY_RATE_LIMITED',
          lastAvailableAt: null,
        },
      );
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('20');
    expect(body).toMatchObject({
      data: null,
      status: 'unavailable',
      providerUsed: null,
      fallbackUsed: true,
      cachedAt: null,
      retryAfterSeconds: 20,
      reasonCode: 'PRIMARY_RATE_LIMITED; SECONDARY_RATE_LIMITED',
    });
  });

  it('returns 503 when the provider chain fails without a cache', async () => {
    const response = await companyProfileMarketDataResponse(async () => {
      throw new MarketDataError(
        'upstream-unavailable',
        'Company profile is temporarily unavailable',
        undefined,
        undefined,
        {
          reason: 'PRIMARY_TIMEOUT; SECONDARY_INVALID_PROVIDER_RESPONSE',
          primaryReason: 'PRIMARY_TIMEOUT',
          fallbackReason: 'SECONDARY_INVALID_PROVIDER_RESPONSE',
          lastAvailableAt: null,
        },
      );
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('unavailable');
    expect(body.retryAfterSeconds).toBe(0);
  });
});
