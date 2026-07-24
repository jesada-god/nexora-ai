import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { SymbolResolver, type InstrumentRecord, type InstrumentRepository } from './symbol-resolver';

const records: InstrumentRecord[] = [
  { symbol: 'AAPL', provider_symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', asset_type: 'Stock', currency: 'USD', status: 'active' },
  { symbol: 'RKLB', provider_symbol: 'RKLB', name: 'Rocket Lab', exchange: 'NASDAQ', asset_type: 'Stock', currency: 'USD', status: 'active' },
  { symbol: 'NVDA', provider_symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ', asset_type: 'Stock', currency: 'USD', status: 'active' },
  { symbol: 'NVTS', provider_symbol: 'NVTS', name: 'Navitas Semiconductor', exchange: 'G', asset_type: 'Stock', currency: 'USD', status: 'active' },
  { symbol: 'CAP', provider_symbol: 'CAP', name: 'Nasdaq Capital Market Corp', exchange: 'S', asset_type: 'Stock', currency: 'USD', status: 'active' },
  { symbol: 'SPY', provider_symbol: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'NYSE Arca', asset_type: 'ETF', currency: 'USD', status: 'active' },
  { symbol: 'BRK.B', provider_symbol: 'BRK.B', name: 'Berkshire Hathaway Class B', exchange: 'NYSE', asset_type: 'Stock', currency: 'USD', status: 'active' },
  { symbol: 'OLD', provider_symbol: 'OLD', name: 'Old Corp', exchange: 'NYSE', asset_type: 'Stock', currency: 'USD', status: 'delisted' },
  { symbol: 'GLOBAL', provider_symbol: 'GLOBAL', name: 'Global Corp', exchange: 'LSE', asset_type: 'Stock', currency: 'GBP', status: 'active' },
];

class FixtureRepository implements InstrumentRepository {
  async findExact(symbol: string) { return records.find((record) => record.symbol === symbol) ?? null; }
}

describe('SymbolResolver', () => {
  const resolver = new SymbolResolver(new FixtureRepository());

  it.each(['AAPL', 'RKLB', 'NVDA', 'NVTS', 'CAP'])('resolves %s through market_instruments identity', async (symbol) => {
    await expect(resolver.resolve(symbol)).resolves.toMatchObject({ canonicalSymbol: symbol, providerSymbol: symbol, mic: 'XNAS', supported: true });
  });

  it('preserves ETF and class-share provider notation', async () => {
    await expect(resolver.resolve('SPY')).resolves.toMatchObject({ assetType: 'etf', mic: 'ARCX', supported: true });
    await expect(resolver.resolve('brk.b')).resolves.toMatchObject({ canonicalSymbol: 'BRK.B', providerSymbol: 'BRK.B', mic: 'XNYS', supported: true });
  });

  it('does not substitute unknown, delisted, or unsupported exchange symbols', async () => {
    await expect(resolver.resolve('UNKNOWN')).resolves.toMatchObject({ canonicalSymbol: 'UNKNOWN', supported: false });
    await expect(resolver.resolve('OLD')).resolves.toMatchObject({ active: false, supported: false, unsupportedReason: 'Instrument is delisted' });
    await expect(resolver.resolve('GLOBAL')).resolves.toMatchObject({ supported: false, unsupportedReason: 'Unsupported exchange: LSE' });
  });
});
