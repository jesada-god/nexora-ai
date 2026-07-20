import { describe, expect, it } from 'vitest';
import { MarketDataError } from './errors';
import {
  marketStatusReasonFromError,
  marketStatusReasonMessage,
} from './market-status';

describe('market status unavailable reasons', () => {
  it.each([
    ['provider-not-configured', 'missing-config'],
    ['provider-unauthorized', 'invalid-config'],
    ['rate-limited', 'rate-limit'],
    ['timeout', 'timeout'],
    ['upstream-unavailable', 'upstream-error'],
    ['invalid-provider-response', 'upstream-error'],
  ] as const)('maps %s to %s', (code, reason) => {
    expect(marketStatusReasonFromError(new MarketDataError(code, 'unsafe provider detail')))
      .toBe(reason);
  });

  it('never exposes the provider error message to the user', () => {
    const unsafe = 'API key abc123 was rejected';
    const reason = marketStatusReasonFromError(
      new MarketDataError('provider-unauthorized', unsafe),
    );
    expect(marketStatusReasonMessage(reason)).not.toContain(unsafe);
    expect(marketStatusReasonMessage(reason)).toContain('ตั้งค่า');
  });
});
