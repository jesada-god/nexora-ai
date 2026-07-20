import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAnalyticsUser: vi.fn(),
  checkAnalyticsRateLimit: vi.fn(),
  loadFairValue: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/src/lib/analytics/api-auth', () => ({
  requireAnalyticsUser: mocks.requireAnalyticsUser,
}));
vi.mock('@/src/lib/analytics/rate-limit', () => ({
  checkAnalyticsRateLimit: mocks.checkAnalyticsRateLimit,
}));
vi.mock('@/src/lib/analytics/valuation/orchestration', () => ({
  loadFairValue: mocks.loadFairValue,
}));

import { GET } from './route';

const unavailable = {
  status: 'unavailable' as const,
  failureKind: 'insufficient-data' as const,
  symbol: 'AAPL',
  currency: 'USD',
  reason: 'Data Sufficiency Gate rejected the inputs',
  missingInputs: ['historicalFinancials>=3Periods'],
  staleInputs: [],
  calculatedAt: '2026-07-20T00:00:00.000Z',
  methodologyVersion: 'nexora-fv-v1' as const,
  limitations: [],
};

function request() {
  return GET(
    new Request('https://example.test/api/analytics/fair-value/AAPL'),
    { params: Promise.resolve({ symbol: 'AAPL' }) },
  );
}

describe('GET /api/analytics/fair-value/[symbol]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalyticsUser.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.checkAnalyticsRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.loadFairValue.mockResolvedValue(unavailable);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns a typed Fair Value result when enabled', async () => {
    vi.stubEnv('FEATURE_FAIR_VALUE', 'true');

    const response = await request();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: unavailable });
    expect(mocks.loadFairValue).toHaveBeenCalledWith('AAPL');
  });

  it('stops before auth/provider work when explicitly disabled', async () => {
    vi.stubEnv('FEATURE_FAIR_VALUE', 'false');
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await request();
    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'feature-disabled',
        message: 'Fair Value feature is disabled by FEATURE_FAIR_VALUE=false',
      },
    });
    expect(mocks.requireAnalyticsUser).not.toHaveBeenCalled();
    expect(mocks.loadFairValue).not.toHaveBeenCalled();
    expect(entry).toEqual({
      event: 'fair_value_evaluation',
      status: 'disabled',
      failureKind: 'feature-disabled',
    });
  });
});
