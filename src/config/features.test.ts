import { afterEach, describe, expect, it, vi } from 'vitest';
import { fairValueEnabled, featureFlagEnabled } from './features';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('server feature flags', () => {
  it('is off unless explicitly set to true', () => {
    expect(featureFlagEnabled(undefined)).toBe(false);
    expect(featureFlagEnabled('false')).toBe(false);
    expect(featureFlagEnabled('1')).toBe(false);
    expect(featureFlagEnabled(' TRUE ')).toBe(true);
  });

  it('enables Fair Value by default but honors an explicit disable', () => {
    delete process.env.FEATURE_FAIR_VALUE;
    expect(fairValueEnabled()).toBe(true);

    vi.stubEnv('FEATURE_FAIR_VALUE', 'false');
    expect(fairValueEnabled()).toBe(false);

    vi.stubEnv('FEATURE_FAIR_VALUE', 'true');
    expect(fairValueEnabled()).toBe(true);
  });
});

