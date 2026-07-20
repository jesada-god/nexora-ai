import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { parseServerEnv } from './server';

describe('server environment parsing', () => {
  it('preserves a valid Alpha Vantage key when an unrelated optional value is invalid', () => {
    const parsed = parseServerEnv({
      APP_URL: 'not-a-url',
      ALPHA_VANTAGE_API_KEY: 'valid-provider-key',
    });

    expect(parsed.data.ALPHA_VANTAGE_API_KEY).toBe(
      'valid-provider-key',
    );
    expect(parsed.data.APP_URL).toBeUndefined();
    expect(parsed.issues).toEqual([
      expect.objectContaining({ path: 'APP_URL' }),
    ]);
  });
});
