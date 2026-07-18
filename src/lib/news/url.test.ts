import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from './url';
describe('safeExternalUrl', () => { it('allows only http(s) links', () => {
  expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
  expect(safeExternalUrl('javascript:alert(1)')).toBeNull(); expect(safeExternalUrl('not a url')).toBeNull();
}); });
