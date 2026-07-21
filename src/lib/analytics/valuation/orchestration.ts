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
  type FairValueFailureKind,
  type FairValueResult,
  type FairValueUnavailable,
  type FinancialPeriod,
  type ValuationInput,
} from './types';
import { createFairValueUnavailable } from './result';

function unavailable(
  failureKind: FairValueFailureKind,
  symbol: string,
  calculatedAt: string,
  reason: string,
  missingFields: string[],
  currency: string | null = null,
  provider: string | null = null,
  asOf: string = calculatedAt,
): FairValueUnavailable {
  return createFairValueUnavailable({
    failureKind,
    symbol,
    currency,
    provider,
    reason,
    missingFields,
    asOf,
    calculatedAt,
    limitations: ['No financial values, estimates, FX rates, peer observations, or fair values are fabricated.'],
  });
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
    provider: provider ?? result.provider ?? undefined,
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
        'calculation-error',
        input.symbol,
        input.calculatedAt ?? new Date().toISOString(),
        'การคำนวณหรือ validation ของ Fair Value ล้มเหลว จึงไม่เผยแพร่ค่าประเมิน',
        ['valuationCalculation'],
        input.currency || null,
        input.source || null,
        input.priceAsOf || input.calculatedAt || new Date().toISOString(),
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
    changeInWorkingCapital: period.changeInWorkingCapital === null ? null : money(period.changeInWorkingCapital),
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

  let market: ReturnType<typeof getMarketDataProvider>;
  try {
    market = getMarketDataProvider();
  } catch (cause) {
    const errorCode = safeFairValueErrorCode(cause);
    return logUnavailable(
      unavailable(
        errorCode === 'rate-limited' ? 'provider-rate-limited' : 'provider-unavailable',
        symbol,
        calculatedAt,
        errorCode === 'rate-limited'
          ? 'ผู้ให้บริการจำกัดคำขอชั่วคราว จึงยังไม่คำนวณ Fair Value'
          : 'ไม่สามารถเริ่มต้น market-data provider ที่จำเป็นต่อ Fair Value ได้',
        ['quote', 'companyProfile'],
        null,
        null,
      ),
      undefined,
      errorCode,
    );
  }

  const [quoteResult, profileResult, financialsResult, historyResult, fxOutcome] =
    await Promise.allSettled([
      market.getQuote(symbol),
      market.getCompanyProfile(symbol),
      fundamentals.getFinancialPeriods(symbol),
      getHistoricalMarketDataService().getHistoricalPrices(symbol, '1y'),
      getFxRate('USD', 'THB'),
    ] as const);
  const requiredFailures = [
    { field: 'companyProfile', provider: market.id, result: profileResult },
    { field: 'financialStatements', provider: fundamentals.id, result: financialsResult },
    { field: 'historicalOHLCV', provider: null, result: historyResult },
  ];
  const failed = requiredFailures.find((item) => item.result.status === 'rejected');
  if (failed?.result.status === 'rejected') {
    const errorCode = safeFairValueErrorCode(failed.result.reason);
    const failureKind: FairValueFailureKind = errorCode === 'rate-limited'
      ? 'provider-rate-limited'
      : ['internal-error', 'Error', 'RangeError', 'unknown-error'].includes(errorCode)
        ? 'calculation-error'
        : 'provider-unavailable';
    return logUnavailable(
      unavailable(
        failureKind,
        symbol,
        calculatedAt,
        failureKind === 'provider-rate-limited'
          ? 'ผู้ให้บริการจำกัดคำขอชั่วคราว จึงยังไม่คำนวณ Fair Value'
          : failureKind === 'calculation-error'
            ? 'เซิร์ฟเวอร์ไม่สามารถเตรียมข้อมูล Fair Value ได้อย่างปลอดภัย'
            : 'ผู้ให้บริการส่งข้อมูลที่จำเป็นไม่สำเร็จ จึงยังไม่คำนวณ Fair Value',
        [failed.field],
        null,
        failed.provider,
      ),
      failed.provider ?? undefined,
      errorCode,
    );
  }
  if (
    profileResult.status !== 'fulfilled'
    || financialsResult.status !== 'fulfilled'
    || historyResult.status !== 'fulfilled'
  ) {
    return logUnavailable(
      unavailable(
        'calculation-error',
        symbol,
        calculatedAt,
        'เซิร์ฟเวอร์ไม่สามารถยืนยันผลจาก provider ได้อย่างปลอดภัย',
        ['providerResult'],
      ),
      undefined,
      'unknown-error',
    );
  }

  const profile = profileResult.value;
  const financials = financialsResult.value;
  const history = historyResult.value;
  const historyPrice = history.data.prices.at(-1);
  const marketPrice = quoteResult.status === 'fulfilled'
    ? quoteResult.value.data.price
    : historyPrice?.close ?? null;
  const marketPriceAsOf = quoteResult.status === 'fulfilled'
    ? quoteResult.value.freshness.asOf ?? calculatedAt
    : historyPrice ? `${historyPrice.date}T00:00:00.000Z` : null;
  if (marketPrice === null || marketPriceAsOf === null) {
    return logUnavailable(
      unavailable(
        'missing-field',
        symbol,
        calculatedAt,
        'Neither a verified quote nor a verified historical close is available for valuation comparison.',
        ['marketPrice'],
        null,
        quoteResult.status === 'fulfilled' ? quoteResult.value.provider ?? market.id : history.provider ?? null,
      ),
    );
  }
  const fxResult = fxOutcome.status === 'fulfilled'
    ? fxOutcome.value
    : { quote: null, unavailable: true };
  const fundamentalsAgeMs = Date.parse(calculatedAt) - Date.parse(financials.fetchedAt);
  if (!Number.isFinite(fundamentalsAgeMs) || fundamentalsAgeMs > 7 * 86_400_000) {
    return logUnavailable(
      unavailable(
        'stale-fundamentals',
        symbol,
        calculatedAt,
        'Financial statements are older than the accepted fundamentals freshness window.',
        ['freshFinancialStatements'],
        financials.currency || null,
        fundamentals.id,
        financials.asOf || calculatedAt,
      ),
      fundamentals.id,
    );
  }
  if (financials.periods.length < 3) {
    const missingFields = [
      ...financials.missingInputs,
      'historicalFinancials>=3Periods',
    ];
    // If the shortfall is because the fundamentals provider throttled or blocked
    // the dataset requests (not because the filings are genuinely absent), report
    // that truthfully instead of implying the company lacks financial data.
    const errorCodes = Object.values(financials.datasetErrors ?? {});
    const rateLimited = errorCodes.length > 0 && errorCodes.every((code) => code === 'rate-limited');
    const unauthorized = errorCodes.length > 0 && errorCodes.every((code) => code === 'provider-unauthorized' || code === 'provider-not-configured');
    if (financials.periods.length === 0 && (rateLimited || unauthorized)) {
      return logUnavailable(
        unavailable(
          rateLimited ? 'provider-rate-limited' : 'provider-unavailable',
          symbol,
          calculatedAt,
          rateLimited
            ? 'ผู้ให้บริการงบการเงินจำกัดคำขอชั่วคราว จึงยังไม่คำนวณ Fair Value กรุณาลองใหม่ภายหลัง'
            : 'บัญชีผู้ให้บริการงบการเงินไม่มีสิทธิ์เข้าถึงข้อมูลที่จำเป็น จึงยังไม่คำนวณ Fair Value',
          missingFields,
          financials.currency || null,
          fundamentals.id,
          financials.asOf || calculatedAt,
        ),
        fundamentals.id,
        rateLimited ? 'rate-limited' : 'provider-unauthorized',
      );
    }
    return logUnavailable(
      unavailable(
        financials.annualRecords.length > 0 ? 'mapping-error' : financials.periods.length > 0 ? 'insufficient-periods' : 'missing-field',
        symbol,
        calculatedAt,
        'provider ที่ตั้งค่าไว้ไม่มีงบการเงินจริงครบพอ จึงไม่คำนวณ Fair Value',
        missingFields,
        financials.currency || null,
        fundamentals.id,
        financials.asOf || calculatedAt,
      ),
      fundamentals.id,
    );
  }

  const sourceCurrency = financials.currency.toUpperCase();
  const quoteCurrency = profile.data.currency?.toUpperCase() ?? sourceCurrency;
  if (sourceCurrency !== quoteCurrency) {
    return logUnavailable(
      unavailable(
        'currency-mismatch',
        symbol,
        calculatedAt,
        'Market quote and financial statements do not share a verified currency.',
        ['currencyConsistency'],
        sourceCurrency,
        fundamentals.id,
        financials.asOf || calculatedAt,
      ),
      fundamentals.id,
    );
  }
  if (sourceCurrency !== 'USD' && sourceCurrency !== 'THB') {
    return logUnavailable(
      unavailable(
        'currency-mismatch',
        symbol,
        calculatedAt,
        `Currency ${sourceCurrency} cannot be normalized to USD by the configured FX service.`,
        ['supportedFxPair'],
        sourceCurrency,
        fundamentals.id,
        financials.asOf || calculatedAt,
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
        fxResult.quote?.source ?? null,
        fxResult.quote?.asOf ?? calculatedAt,
      ),
      fxResult.quote?.source,
    );
  }

  const toUsd = (value: number) => sourceCurrency === 'THB' ? value / fxRate! : value;
  const periods = sourceCurrency === 'THB'
    ? financials.periods.map((period) => convertPeriodToUsd(period, fxRate!))
    : financials.periods;
  // Truthful provider provenance: the source that actually supplied the periods,
  // which may be the configured secondary after an eligible primary failure.
  const fundamentalsProviderUsed = financials.providerUsed ?? fundamentals.id;
  if (process.env.NODE_ENV !== 'production') {
    console.info(JSON.stringify({
      event: 'fair-value-provider-provenance',
      symbol,
      primaryProvider: financials.primaryProvider ?? fundamentals.id,
      providerUsed: fundamentalsProviderUsed,
      fallbackUsed: financials.fallbackUsed ?? false,
      fallbackReason: financials.fallbackReason ?? null,
    }));
  }
  const providerStatus = Object.values(financials.diagnostics.cache).includes('stale')
    ? 'stale'
    : Object.values(financials.diagnostics.cache).every((status) => status === 'hit')
      ? 'cached'
      : quoteResult.status !== 'fulfilled' || quoteResult.value.freshness.status === 'delayed' || quoteResult.value.freshness.status === 'end-of-day'
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
    marketPrice: toUsd(marketPrice),
    marketCapitalization: profile.data.marketCapitalization == null
      ? null
      : toUsd(profile.data.marketCapitalization),
    priceAsOf: marketPriceAsOf,
    source: fundamentalsProviderUsed,
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
