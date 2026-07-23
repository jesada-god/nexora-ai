import { describe, expect, it } from 'vitest';
import { isCompatibleSelection } from '@/src/lib/market-data/gateway/capabilities';
import { TRADER_TIMEFRAME_PRESETS, traderPresetForInterval } from './trader-chart-presets';

describe('legacy trader chart presets', () => {
  it('exposes the complete legacy timeframe set in display order', () => {
    expect(TRADER_TIMEFRAME_PRESETS.map((preset) => preset.interval)).toEqual([
      '1m', '5m', '10m', '15m', '1h', '4h', '1D', 'Week',
    ]);
  });

  it('maps every timeframe to a gateway-compatible history range', () => {
    for (const preset of TRADER_TIMEFRAME_PRESETS) {
      expect(isCompatibleSelection(preset.interval, preset.range), preset.interval).toBe(true);
    }
  });

  it('includes extended hours only for intraday trader presets', () => {
    expect(TRADER_TIMEFRAME_PRESETS.filter((preset) => preset.session === 'extended').map((preset) => preset.interval))
      .toEqual(['1m', '5m', '10m', '15m', '1h', '4h']);
    expect(traderPresetForInterval('Month')).toBeNull();
  });
});
