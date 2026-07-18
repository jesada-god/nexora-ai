import { describe, expect, it } from 'vitest';
import { canLoadHistory, historyErrorMessage } from './history-policy';
describe('ChartPanel request policy', () => {
  it('does not refresh in a hidden browser tab', () => { expect(canLoadHistory(true, 'hidden')).toBe(false); expect(canLoadHistory(true, 'visible')).toBe(true); });
  it('shows quota separately from an invalid key', () => { expect(historyErrorMessage('rate-limited')).toContain('โควตา'); expect(historyErrorMessage('provider-unauthorized')).toContain('การตั้งค่า'); });
});
