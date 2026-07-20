import 'server-only';
import { getHistoricalMarketDataService, getMarketDataProvider } from '@/src/lib/market-data';
import { getFxRate } from '@/src/lib/market-data/fx/service';
import { getFundamentalsProvider } from '../fundamentals/provider';
import { calculateFairValue } from './engine';
import {
  safeFairValueErrorCode,
  writeFairValueLog,
  type FairValueLogger,
} from './logging';
import {
  METHODOLOGY_VERSION,
  type FairValueFailureKind,
  type FairValueResult,
  type FairValueUnavailable,
  type FinancialPeriod,
  type ValuationInput,
} from './types';

function unavailable(
  failureKind: FairValueFailureKind,
  symbol: string,
  calculatedAt: string,
  reason: string,
  missingInputs: string[],
  currency: string | null = null,
): FairValueUnavailable {
  return {
    status: 'unavailable',
    failureKind,
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

function logUnavailable(
  result: FairValueUnavailable,
  provider?: string,
  errorCode?: string,
  logger: FairValueLogger = writeFairValueLog,
): FairValueUnavailable {
  logger({
    event: 'fair_value_evaluation',
    status: 'unavailable',
    symbol: result.symbol,
    provider,
    failureKind: result.failureKind,
    missingInputCount: result.missingInputs.length,
    errorCode,
  });
  return result;
}

export function calculateFairValueSafely(
  input: ValuationInput,
  calculate: typeof calculateFairValue = calculateFairValue,
  logger: FairValueLogger = writeFairValueLog,
): FairValueResult {
  try {
    const result = calculate(input);
    if (result.status === 'unavailable') {
      return logUnavailable(result, input.source, undefined, logger);
    }
    logger({
      event: 'fair_value_evaluation',
      status: 'available',
      symbol: result.symbol,
      provider: input.source,
      missingInputCount: result.missingInputs.length,
    });
    return result;
  } catch (cause) {
    const errorCode = safeFairValueErrorCode(cause);
    return logUnavailable(
      unavailable(
        'calculation-failure',
        input.symbol,
        input.calculatedAt ?? new Date().toISOString(),
        'การคำนวณหรือ validation ของ Fair Value ล้มเหลว จึงไม่เผยแพร่ค่าประเมิน',
        ['valuationCalculation'],
        input.currency || null,
      ),
      input.source,
      errorCode,
      logger,
    );
  }
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

export async function loadFairValue(symbol: string): Promise<FairValueResult> {
  const calculatedAt = new Date().toISOString();
  const fundamentals = getFundamentalsProvider();
  if (!fundamentals) {
    return logUnavailable(
      unavailable(
        'provider-unavailable',
        symbol,
        calculatedAt,
        'ไม่ได้ตั้งค่า provider งบการเงินจริง (`ALPHA_VANTAGE_API_KEY` ไม่มีค่า) จึงไม่คำนวณ Fair Value',
        ['incomeStatement', 'balanceSheet', 'cashFlowStatement', 'cashAndDebt', 'dilutedShares', 'historicalFinancials'],
      ),
    );
  }

  const market = getMarketDataProvider();
  const loadProviderData = () => Promise.all([
    market.getQuote(symbol),
    market.getCompanyProfile(symbol),
    fundamentals.getFinancialPeriods(symbol),
    getHistoricalMarketDataService().getHistoricalPrices(symbol, '1y'),
    getFxRate('USD', 'THB'),
  ] as const);

  let providerData: Awaited<ReturnType<typeof loadProviderData>>;
  try {
    providerData = await loadProviderData();
  } catch (cause) {
    const errorCode = safeFairValueErrorCode(cause);
    return logUnavailable(
      unavailable(
        'provider-unavailable',
        symbol,
        calculatedAt,
        `provider ส่งข้อมูลที่จำเป็นไม่สำเร็จ (${errorCode}) จึงไม่คำนวณ Fair Value`,
        ['quote', 'companyProfile', 'financialStatements', 'historicalOHLCV'],
      ),
      fundamentals.id,
      errorCode,
    );
  }

  const [quote, profile, financials, history, fxResult] = providerData;
  if (!financials.periods.length) {
    return logUnavailable(
      unavailable(
        'provider-unavailable',
        symbol,
        calculatedAt,
        'provider ที่ตั้งค่าไว้ไม่มีงบการเงินจริงครบพอ จึงไม่คำนวณ Fair Value',
        financials.missingInputs,
        financials.currency || null,
      ),
      fundamentals.id,
    );
  }

  const sourceCurrency = financials.currency.toUpperCase();
  const quoteCurrency = profile.data.currency?.toUpperCase() ?? sourceCurrency;
  if (sourceCurrency !== quoteCurrency) {
    return logUnavailable(
      unavailable(
        'insufficient-data',
        symbol,
        calculatedAt,
        'Market quote and financial statements do not share a verified currency.',
        ['currencyConsistency'],
        sourceCurrency,
      ),
      fundamentals.id,
    );
  }
  if (sourceCurrency !== 'USD' && sourceCurrency !== 'THB') {
    return logUnavailable(
      unavailable(
        'insufficient-data',
        symbol,
        calculatedAt,
        `Currency ${sourceCurrency} cannot be normalized to USD by the configured FX service.`,
        ['supportedFxPair'],
        sourceCurrency,
      ),
      fundamentals.id,
    );
  }

  const fxRate = fxResult.quote ? Number(fxResult.quote.rate) : null;
  if (sourceCurrency === 'THB' && (!(fxRate && Number.isFinite(fxRate) && fxRate > 0))) {
    return logUnavailable(
      unavailable(
        'provider-unavailable',
        symbol,
        calculatedAt,
        'ไม่มีอัตรา USD/THB จริงที่ตรวจสอบได้ จึงไม่แปลงข้อมูล THB เพื่อคำนวณ Fair Value',
        ['verifiedUsdThbFx'],
        sourceCurrency,
      ),
      fxResult.quote?.source,
    );
  }

  const toUsd = (value: number) => sourceCurrency === 'THB' ? value / fxRate! : value;
  const periods = sourceCurrency === 'THB'
    ? financials.periods.map((period) => convertPeriodToUsd(period, fxRate!))
    : financials.periods;
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
        status: fxResult.quote.stale
          ? 'stale' as const
          : fxResult.quote.cached ? 'cached' as const : 'live' as const,
      }
    : null;

  return calculateFairValueSafely({
    symbol,
    currency: 'USD',
    marketPrice: toUsd(quote.data.price),
    marketCapitalization: profile.data.marketCapitalization == null
      ? null
      : toUsd(profile.data.marketCapitalization),
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
