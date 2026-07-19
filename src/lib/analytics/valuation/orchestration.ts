import 'server-only';
import { getHistoricalMarketDataService, getMarketDataProvider } from '@/src/lib/market-data';
import { getFxRate } from '@/src/lib/market-data/fx/service';
import { getFundamentalsProvider } from '../fundamentals/provider';
import { calculateFairValue } from './engine';
import { METHODOLOGY_VERSION, type FairValueUnavailable, type FinancialPeriod } from './types';

function unavailable(symbol: string, calculatedAt: string, reason: string, missingInputs: string[], currency: string | null = null): FairValueUnavailable {
  return {
    status: 'unavailable',
    symbol,
    currency,
    reason,
    missingInputs,
    staleInputs: [],
    calculatedAt,
    methodologyVersion: METHODOLOGY_VERSION,
    limitations: ['No financial values, estimates, FX rates, peer observations, or fair values are fabricated.'],
  };
}

function convertPeriodToUsd(period: FinancialPeriod, rate: number): FinancialPeriod {
  const money = (value: number) => value / rate;
  const optionalMoney = (value: number | null | undefined) => value == null ? value : money(value);
  return {
    ...period,
    currency: 'USD',
    revenue: money(period.revenue),
    operatingIncome: money(period.operatingIncome),
    netIncome: money(period.netIncome),
    depreciationAmortization: money(period.depreciationAmortization),
    capitalExpenditure: money(period.capitalExpenditure),
    changeInWorkingCapital: money(period.changeInWorkingCapital),
    operatingCashFlow: money(period.operatingCashFlow),
    freeCashFlow: money(period.freeCashFlow),
    dividendsPaid: period.dividendsPaid == null ? null : money(period.dividendsPaid),
    interestExpense: money(period.interestExpense),
    totalDebt: money(period.totalDebt),
    cash: money(period.cash),
    totalAssets: money(period.totalAssets),
    totalLiabilities: money(period.totalLiabilities),
    grossProfit: optionalMoney(period.grossProfit),
    ebitda: optionalMoney(period.ebitda),
    dilutedEps: optionalMoney(period.dilutedEps),
    totalEquity: optionalMoney(period.totalEquity),
  };
}

export async function loadFairValue(symbol: string): Promise<ReturnType<typeof calculateFairValue> | FairValueUnavailable> {
  const calculatedAt = new Date().toISOString();
  const fundamentals = getFundamentalsProvider();
  if (!fundamentals) {
    return unavailable(
      symbol,
      calculatedAt,
      'provider ปัจจุบันยังไม่มี normalized income statement, balance sheet และ cash-flow statement จึงไม่คำนวณ Fair Value',
      ['incomeStatement', 'balanceSheet', 'cashFlowStatement', 'cashAndDebt', 'dilutedShares', 'historicalFinancials'],
    );
  }

  const market = getMarketDataProvider();
  const [quote, profile, financials, history, fxResult] = await Promise.all([
    market.getQuote(symbol),
    market.getCompanyProfile(symbol),
    fundamentals.getFinancialPeriods(symbol),
    getHistoricalMarketDataService().getHistoricalPrices(symbol, '1y'),
    getFxRate('USD', 'THB'),
  ]);
  if (!financials.periods.length) {
    return unavailable(symbol, calculatedAt, 'Configured provider returned only a partial fundamentals snapshot; Fair Value was not calculated.', financials.missingInputs, financials.currency || null);
  }

  const sourceCurrency = financials.currency.toUpperCase();
  const quoteCurrency = profile.data.currency?.toUpperCase() ?? sourceCurrency;
  if (sourceCurrency !== quoteCurrency) {
    return unavailable(symbol, calculatedAt, 'Market quote and financial statements do not share a verified currency.', ['currencyConsistency'], sourceCurrency);
  }
  if (sourceCurrency !== 'USD' && sourceCurrency !== 'THB') {
    return unavailable(symbol, calculatedAt, `Currency ${sourceCurrency} cannot be normalized to USD by the configured FX service.`, ['supportedFxPair'], sourceCurrency);
  }
  const fxRate = fxResult.quote ? Number(fxResult.quote.rate) : null;
  if (sourceCurrency === 'THB' && (!(fxRate && Number.isFinite(fxRate) && fxRate > 0))) {
    return unavailable(symbol, calculatedAt, 'ไม่มีอัตรา USD/THB จริงที่ตรวจสอบได้ จึงไม่แปลงข้อมูล THB เพื่อคำนวณ Fair Value', ['verifiedUsdThbFx'], sourceCurrency);
  }

  const toUsd = (value: number) => sourceCurrency === 'THB' ? value / fxRate! : value;
  const periods = sourceCurrency === 'THB' ? financials.periods.map((period) => convertPeriodToUsd(period, fxRate!)) : financials.periods;
  const providerStatus = Object.values(financials.diagnostics.cache).includes('stale')
    ? 'stale'
    : Object.values(financials.diagnostics.cache).every((status) => status === 'hit')
      ? 'cached'
      : quote.freshness.status === 'delayed' || quote.freshness.status === 'end-of-day'
        ? 'delayed'
        : 'live';
  const displayFx = fxResult.quote && fxRate && Number.isFinite(fxRate) && fxRate > 0
    ? {
        rate: fxRate,
        asOf: fxResult.quote.asOf,
        provider: fxResult.quote.source,
        status: fxResult.quote.stale ? 'stale' as const : fxResult.quote.cached ? 'cached' as const : 'live' as const,
      }
    : null;

  return calculateFairValue({
    symbol,
    currency: 'USD',
    marketPrice: toUsd(quote.data.price),
    marketCapitalization: profile.data.marketCapitalization == null ? null : toUsd(profile.data.marketCapitalization),
    priceAsOf: quote.freshness.asOf ?? calculatedAt,
    source: fundamentals.id,
    sourceType: 'provider-supplied',
    sector: profile.data.sector ?? '',
    industry: profile.data.industry ?? '',
    periods,
    historicalPrices: history.data.prices,
    historySource: history.provider ?? history.data.providerUsed ?? 'historical-provider',
    historyFreshness: history.freshness,
    forwardEpsGrowth: null,
    providerStatus,
    displayFx,
    calculatedAt,
  });
}
