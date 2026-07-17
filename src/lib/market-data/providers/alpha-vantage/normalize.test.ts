import { describe, expect, it } from 'vitest';
import {
  normalizeHistoryResponse,
  normalizeMarketOverviewResponse,
  normalizeProfileResponse,
  normalizeQuoteResponse,
  normalizeSearchResponse,
} from './normalize';

describe('Alpha Vantage normalization', () => {
  it('normalizes symbol search results', () => {
    const result = normalizeSearchResponse({
      bestMatches: [{
        '1. symbol': 'IBM',
        '2. name': 'International Business Machines',
        '3. type': 'Equity',
        '4. region': 'United States',
        '5. marketOpen': '09:30',
        '6. marketClose': '16:00',
        '7. timezone': 'UTC-04',
        '8. currency': 'USD',
        '9. matchScore': '0.95',
      }],
    });

    expect(result[0]).toMatchObject({ symbol: 'IBM', currency: 'USD', matchScore: 0.95 });
  });

  it('normalizes strings and percentages in a quote to numbers', () => {
    const result = normalizeQuoteResponse({
      'Global Quote': {
        '01. symbol': 'IBM',
        '02. open': '284.0000',
        '03. high': '286.0900',
        '04. low': '282.2200',
        '05. price': '285.1200',
        '06. volume': '1234567',
        '07. latest trading day': '2026-07-17',
        '08. previous close': '283.5000',
        '09. change': '1.6200',
        '10. change percent': '0.5714%',
      },
    });

    expect(result).toMatchObject({
      symbol: 'IBM',
      price: 285.12,
      changePercent: 0.5714,
      volume: 1234567,
      latestTradingDay: '2026-07-17',
    });
  });

  it('sorts and filters daily history for the requested range', () => {
    const result = normalizeHistoryResponse({
      'Time Series (Daily)': {
        '2026-07-17': { '1. open': '10', '2. high': '12', '3. low': '9', '4. close': '11', '5. volume': '100' },
        '2026-05-01': { '1. open': '8', '2. high': '9', '3. low': '7', '4. close': '8', '5. volume': '80' },
        '2026-07-01': { '1. open': '9', '2. high': '11', '3. low': '8', '4. close': '10', '5. volume': '90' },
      },
    }, 'IBM', '1m', new Date('2026-07-18T00:00:00.000Z'));

    expect(result.prices.map((price) => price.date)).toEqual(['2026-07-01', '2026-07-17']);
  });

  it('normalizes a company profile and invalid optional URLs', () => {
    const result = normalizeProfileResponse({
      Symbol: 'IBM',
      Name: 'International Business Machines',
      OfficialSite: 'not-a-url',
      MarketCapitalization: '250000000000',
      FullTimeEmployees: '270000',
      LatestQuarter: '2026-06-30',
    });

    expect(result.website).toBeNull();
    expect(result.marketCapitalization).toBe(250000000000);
    expect(result.employees).toBe(270000);
  });

  it('normalizes global market status', () => {
    const result = normalizeMarketOverviewResponse({
      markets: [{
        market_type: 'Equity',
        region: 'United States',
        primary_exchanges: 'NASDAQ, NYSE',
        local_open: '09:30',
        local_close: '16:00',
        current_status: 'open',
        notes: '',
      }],
    });

    expect(result.markets[0]).toMatchObject({
      primaryExchanges: ['NASDAQ', 'NYSE'],
      currentStatus: 'open',
      notes: null,
    });
  });
});
