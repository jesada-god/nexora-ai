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

  it('parses the Polygon production market-data configuration', () => {
    const parsed = parseServerEnv({
      POLYGON_API_KEY: 'polygon-secret',
      MARKET_DATA_PROVIDER: 'polygon',
    });

    expect(parsed.data.POLYGON_API_KEY).toBe('polygon-secret');
    expect(parsed.data.MARKET_DATA_PROVIDER).toBe('polygon');
    expect(parsed.issues).toEqual([]);
  });

  it('treats blank Polygon values as unset without raising configuration issues', () => {
    const parsed = parseServerEnv({ POLYGON_API_KEY: '', MARKET_DATA_PROVIDER: '' });

    expect(parsed.data.POLYGON_API_KEY).toBeUndefined();
    expect(parsed.data.MARKET_DATA_PROVIDER).toBeUndefined();
    expect(parsed.issues).toEqual([]);
  });
});
