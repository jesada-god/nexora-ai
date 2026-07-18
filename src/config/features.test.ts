import { describe, expect, it } from 'vitest';
import { featureFlagEnabled } from './features';

describe('server feature flags', () => {
  it('is off unless explicitly set to true', () => {
    expect(featureFlagEnabled(undefined)).toBe(false);
    expect(featureFlagEnabled('false')).toBe(false);
    expect(featureFlagEnabled('1')).toBe(false);
    expect(featureFlagEnabled(' TRUE ')).toBe(true);
  });
});

