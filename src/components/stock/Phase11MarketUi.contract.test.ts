import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const intraday = read('src/components/stock/IntradayChartPanel.tsx');
const options = read('src/components/stock/OptionsChainPanel.tsx');
const chart = read('src/components/stock/ChartPanel.tsx');
const simulator = read('src/components/options-simulator/SimulatorWorkspace.tsx');
const middleware = read('middleware.ts');

describe('Phase 11 market UI production contract', () => {
  it('keeps intraday requests isolated, cancellable, visibility-aware and independent of pan/zoom', () => {
    expect(intraday).toContain('new Map<string, CanonicalIntradaySeries>()');
    expect(intraday).toContain('`${symbol}:${sourceInterval}:${range}:${sessionMode}`');
    expect(intraday).toContain('AbortController');
    expect(intraday).toContain('generation.current');
    expect(intraday).toContain('useAppActive');
    expect(intraday).toContain('connection?.saveData');
    expect(intraday).not.toMatch(/onPan|onZoom|wheel.*fetch|pointer.*fetch/i);
  });

  it('derives H4 from real 60m bars and never passes daily data into the H4 aggregator', () => {
    expect(intraday).toContain("interval === '4h' ? '60m' : interval");
    expect(intraday).toContain('aggregateSessionAwareH4(series.bars)');
    expect(intraday).not.toContain('initialHistory');
    expect(chart).toContain('H4 ไม่สร้างจาก Daily');
  });

  it('lazy-loads the options UI with generation guards, cooldown and virtualization', () => {
    expect(options).toContain('generation.current');
    expect(options).toContain('AbortController');
    expect(options).toContain('Retry-After');
    expect(options).toContain('Virtualized options chain');
    expect(options).toContain('VIEWPORT_HEIGHT');
    expect(options).toContain('connection?.saveData');
  });

  it('revalidates a selected contract through the server API and marks edits custom', () => {
    expect(simulator).toContain('/api/market/options/chain?');
    expect(simulator).toContain('importOptionContract(current, parsed.data, contractSymbol)');
    expect(simulator).toContain("inputMode: 'custom' as const");
    expect(simulator).toContain("'ข้อมูลจริง' : 'กำหนดเอง'");
  });

  it('does not reference server market-data secrets from client components', () => {
    for (const source of [intraday, options, chart, simulator]) {
      expect(source).not.toMatch(/ALPHA_VANTAGE_API_KEY|FMP_API_KEY|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET/);
    }
  });

  it('restricts browser connections and blocks framing through security headers', () => {
    expect(middleware).toContain("`connect-src ${[`'self'`, ...supabaseConnectSources()].join(' ')}`");
    expect(middleware).toContain("`frame-ancestors 'none'`");
    expect(middleware).toContain("response.headers.set('X-Content-Type-Options', 'nosniff')");
  });
});
