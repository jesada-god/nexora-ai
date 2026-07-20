import { calculateTechnicalAnalysis } from '../technical/calculations';
import { calculateSupportResistance } from '../support-resistance/calculations';
import { classifyCompany } from './classification';
import { compositeValuation } from './formulas';
import { fundamentalQuality, modelReliability } from './quality';
import { selectSectorModels } from './sector-selection';
import {
  METHODOLOGY_VERSION,
  SECTOR_RULE_VERSION,
  type FairValueResult,
  type FinancialPeriod,
  type ValuationInput,
  type ValuationInputDisclosure,
} from './types';

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function allFinite(period: FinancialPeriod) {
  return Object.entries(period).every(([key, value]) =>
    key === 'periodEnd'
    || key === 'currency'
    || key === 'restated'
    || (['dividendsPaid', 'grossProfit', 'ebitda', 'dilutedEps', 'totalEquity'].includes(key) && (value === null || value === undefined))
    || (typeof value === 'number' && Number.isFinite(value)),
  );
}

export function dataSufficiency(input: Partial<ValuationInput>, now = Date.now()) {
  const missingInputs: string[] = [];
  const staleInputs: string[] = [];
  if (!input.symbol) missingInputs.push('symbol');
  if (!input.currency) missingInputs.push('currency');
  if (input.currency && input.currency !== 'USD') missingInputs.push('valuationInputsNormalizedToUSD');
  if (input.marketPrice == null || !Number.isFinite(input.marketPrice) || input.marketPrice <= 0) missingInputs.push('marketPrice>0');
  if (!input.priceAsOf) missingInputs.push('priceAsOf');
  if (!input.sector) missingInputs.push('sector');
  if (!input.industry) missingInputs.push('industry');
  if (!input.periods || input.periods.length < 3) missingInputs.push('historicalFinancials>=3Periods');
  if (!input.historicalPrices || input.historicalPrices.length < 50) missingInputs.push('historicalOHLCV>=50DailyPeriods');
  if (input.priceAsOf && now - new Date(input.priceAsOf).valueOf() > 7 * 86_400_000) staleInputs.push('marketPrice');
  const periods = input.periods ?? [];
  const dates = periods.map((period) => period.periodEnd);
  if (new Set(dates).size !== dates.length) missingInputs.push('duplicateFiscalPeriodsMustBeResolved');
  if (periods.some((period) => period.currency !== input.currency)) missingInputs.push('currencyNormalization');
  if (periods.some((period) => !allFinite(period) || period.dilutedShares <= 0 || period.totalAssets < 0 || period.totalDebt < 0 || period.cash < 0)) missingInputs.push('validFiniteNormalizedFinancialValues');
  if (periods.some((period, index) => index > 0 && period.periodEnd <= periods[index - 1].periodEnd)) missingInputs.push('orderedUniqueFiscalPeriods');
  return { ok: missingInputs.length === 0, missingInputs: [...new Set(missingInputs)], staleInputs };
}

export function calculateFairValue(input: ValuationInput, now = Date.now()): FairValueResult {
  const calculatedAt = input.calculatedAt ?? new Date(now).toISOString();
  const gate = dataSufficiency(input, now);
  if (!gate.ok) {
    return {
      status: 'unavailable',
      failureKind: 'insufficient-data',
      symbol: input.symbol,
      currency: input.currency || null,
      reason: 'ข้อมูลจริงไม่เพียงพอหรือไม่ผ่าน Data Sufficiency Gate จึงไม่สร้าง Fair Value',
      missingInputs: gate.missingInputs,
      staleInputs: gate.staleInputs,
      calculatedAt,
      methodologyVersion: METHODOLOGY_VERSION,
      limitations: ['No defaults or synthetic financial statements are inserted.'],
    };
  }

  const selection = selectSectorModels(input);
  if (!selection.models.length) {
    return {
      status: 'unavailable',
      failureKind: 'insufficient-data',
      symbol: input.symbol,
      currency: input.currency,
      reason: 'ไม่มี valuation model ที่เหมาะสมและผ่าน validation',
      missingInputs: selection.excludedModels.map((item) => `${item.model}: ${item.reason}`),
      staleInputs: gate.staleInputs,
      calculatedAt,
      methodologyVersion: METHODOLOGY_VERSION,
      limitations: ['A model is never forced onto an unsuitable company.'],
    };
  }

  const baseClassification = classifyCompany(input.sector, input.industry, input.periods);
  const classification = {
    ...baseClassification,
    eligibleModels: selection.models.map((model) => model.model),
    excludedModels: selection.excludedModels,
    evidence: [
      ...baseClassification.evidence,
      `Sector rule ${selection.rule.ruleId} selected from normalized sector and industry`,
      ...selection.models.map((model) => `${model.model}: ${model.reason ?? 'model-specific validation passed'}`),
    ],
  };
  const quality = fundamentalQuality(input.periods);
  const rawWeights = Object.fromEntries(selection.models.map((model) => [model.model, selection.rule.modelWeights[model.model] ?? 0]));
  const composite = compositeValuation(selection.models, rawWeights);
  const uncertainty = Math.min(0.45, 0.12 + composite.dispersion * 0.5 + (100 - quality.score) / 400);
  const periodConsistency = 100;
  const completeness = Math.max(0, 100 - selection.excludedModels.length * 8);
  const freshness = gate.staleInputs.length ? 35 : input.providerStatus === 'cached' ? 75 : 100;
  const currencyConsistency = 100;
  const reliability = modelReliability({
    completeness,
    freshness,
    periodConsistency,
    modelCount: composite.models.length,
    dispersion: composite.dispersion,
    cashFlowStability: Math.min(100, quality.score),
    peerSampleSize: 0,
    currencyConsistency,
    sensitivity: uncertainty,
  });

  const scenarioFor = (index: number) => composite.models[index].scenarios ?? {
    conservative: composite.models[index].fairValue,
    base: composite.models[index].fairValue,
    optimistic: composite.models[index].fairValue,
  };
  const blendedScenario = (scenario: 'conservative' | 'base' | 'optimistic') =>
    composite.models.reduce((sum, model, index) => sum + scenarioFor(index)[scenario] * model.weight, 0);
  const conservative = blendedScenario('conservative');
  const base = blendedScenario('base');
  const optimistic = blendedScenario('optimistic');
  if (!(conservative <= base && base <= optimistic) || ![conservative, base, optimistic].every(Number.isFinite)) {
    return {
      status: 'unavailable',
      failureKind: 'calculation-failure',
      symbol: input.symbol,
      currency: input.currency,
      reason: 'Scenario validation failed; Fair Value was not published.',
      missingInputs: ['conservative<=base<=optimistic'],
      staleInputs: gate.staleInputs,
      calculatedAt,
      methodologyVersion: METHODOLOGY_VERSION,
      limitations: ['Scenario results are validated, never silently sorted.'],
    };
  }
  const range = (scenario: 'conservative' | 'base' | 'optimistic') => ({
    low: Math.min(...composite.models.map((model, index) => scenarioFor(index)[scenario])),
    high: Math.max(...composite.models.map((model, index) => scenarioFor(index)[scenario])),
  });
  const ranges = {
    conservative: range('conservative'),
    base: range('base'),
    optimistic: range('optimistic'),
    centralEstimate: base,
    dispersion: composite.dispersion,
  };
  const technical = technicalMarketContext(input, ranges.base);
  const latest = input.periods.at(-1)!;
  const detail = (field: string, value: number | string, currency: string | null, origin: ValuationInputDisclosure['origin'] = 'provider'): ValuationInputDisclosure => ({
    field,
    value,
    currency,
    period: latest.periodEnd,
    provider: input.source,
    asOf: latest.periodEnd,
    status: gate.staleInputs.length ? 'stale' : 'available',
    origin,
  });
  const inputDetails = [
    detail('Current Price', input.marketPrice, 'USD'),
    ...(composite.models.some((model) => model.model === 'ev-sales' || model.model === 'fcff-dcf') ? [detail('Revenue', latest.revenue, 'USD')] : []),
    ...(composite.models.some((model) => model.model === 'ev-ebitda') ? [detail('EBITDA', latest.ebitda ?? latest.operatingIncome + latest.depreciationAmortization, 'USD', latest.ebitda == null ? 'derived' : 'provider')] : []),
    ...(composite.models.some((model) => model.model === 'pe' || model.model === 'peg') && latest.dilutedEps != null ? [detail('Diluted EPS', latest.dilutedEps, 'USD')] : []),
    ...(composite.models.some((model) => model.model === 'pb') ? [detail('Total Equity', latest.totalEquity ?? latest.totalAssets - latest.totalLiabilities, 'USD', latest.totalEquity == null ? 'derived' : 'provider')] : []),
    ...(composite.models.some((model) => model.model === 'ddm') && latest.dividendsPaid != null ? [detail('Dividend per Share', Math.abs(latest.dividendsPaid) / latest.dilutedShares, 'USD', 'derived')] : []),
    ...(composite.models.some((model) => model.model === 'fcff-dcf') ? [
      detail('Operating Cash Flow', latest.operatingCashFlow, 'USD'),
      detail('Capital Expenditure', latest.capitalExpenditure, 'USD'),
      detail('Free Cash Flow', latest.freeCashFlow, 'USD', 'derived'),
    ] : []),
    ...(composite.models.some((model) => ['ev-sales', 'ev-ebitda', 'fcff-dcf'].includes(model.model)) ? [
      detail('Total Debt', latest.totalDebt, 'USD'),
      detail('Cash & Equivalents', latest.cash, 'USD'),
    ] : []),
    ...(composite.models.some((model) => ['ev-sales', 'ev-ebitda', 'fcff-dcf', 'pb', 'ddm'].includes(model.model)) ? [detail('Diluted Shares Outstanding', latest.dilutedShares, null)] : []),
    ...(composite.models.some((model) => model.model === 'ev-sales' || model.model === 'ev-ebitda') && finite(input.marketCapitalization) ? [detail('Market Cap', input.marketCapitalization, 'USD')] : []),
  ];
  const upsideAmount = base - input.marketPrice;
  const upsidePercent = (upsideAmount / input.marketPrice) * 100;
  const dataStatus = gate.staleInputs.length || input.providerStatus === 'stale'
      ? 'stale'
      : input.providerStatus === 'cached'
        ? 'cached'
        : input.providerStatus === 'delayed'
          ? 'delayed'
          : 'limited';
  const reliabilityReasons = [
    `${input.periods.length} normalized financial periods available`,
    `${composite.models.length} model(s) passed validation`,
    'Versioned model assumptions reduce reliability versus verified peer or analyst observations',
    ...(gate.staleInputs.length ? [`Stale inputs: ${gate.staleInputs.join(', ')}`] : []),
    ...selection.excludedModels.map((model) => `${model.model} excluded: ${model.reason}`),
  ];

  return {
    status: 'available',
    symbol: input.symbol,
    currency: 'USD',
    marketPrice: { value: input.marketPrice, asOf: input.priceAsOf, source: input.source, sourceType: input.sourceType },
    companyClassification: classification,
    modelResults: composite.models,
    excludedModels: selection.excludedModels,
    fundamentalFairValue: ranges,
    technicalContext: technical,
    fundamentalQuality: quality,
    dataQuality: { score: (completeness + freshness + periodConsistency + currencyConsistency) / 4, completeness, freshness, periodConsistency, currencyConsistency },
    modelReliability: reliability,
    reliabilityReasons,
    missingInputs: selection.excludedModels.map((model) => `${model.model}: ${model.reason}`),
    dataStatus,
    selectedModel: composite.models.length > 1 ? 'blended' : composite.models[0].model,
    upsideAmount,
    upsidePercent,
    sector: input.sector,
    industry: input.industry,
    sectorRuleId: selection.rule.ruleId,
    sectorRuleVersion: SECTOR_RULE_VERSION,
    inputDetails,
    assumptionDetails: selection.assumptions,
    displayFx: input.displayFx ?? null,
    inputs: { periods: input.periods, historicalPriceRows: input.historicalPrices.length },
    assumptions: { sectorRule: selection.rule.ruleId, version: SECTOR_RULE_VERSION, details: selection.assumptions },
    sources: [
      { name: input.source, asOf: input.priceAsOf, sourceType: input.sourceType },
      { name: input.historySource, asOf: input.historicalPrices.at(-1)!.date, sourceType: 'provider-supplied' },
    ],
    latestDataAt: [input.priceAsOf, ...input.periods.map((period) => period.periodEnd), input.historicalPrices.at(-1)!.date].toSorted().at(-1)!,
    calculatedAt,
    methodologyVersion: METHODOLOGY_VERSION,
    limitations: [
      'Model estimate — not a market quote',
      'เป็นค่าประเมินจากแบบจำลอง ไม่ใช่ราคาตลาดหรือคำแนะนำในการลงทุน',
      'Technical indicators do not alter the fundamental fair value.',
      'Versioned relative multiples are model assumptions, not provider data or fabricated peer observations.',
    ],
  };
}

function technicalMarketContext(input: ValuationInput, fairValue: { low: number; high: number }) {
  const rows = input.historicalPrices;
  const latest = rows.at(-1)!;
  const closes = rows.map((row) => row.close);
  const high = Math.max(...rows.slice(-252).map((row) => row.high));
  const low = Math.min(...rows.slice(-252).map((row) => row.low));
  const peak = Math.max(...closes);
  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const volatility = Math.sqrt(returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, returns.length - 1)) * Math.sqrt(252);
  const analysis = calculateTechnicalAnalysis(rows, { symbol: input.symbol, source: input.historySource, freshness: input.historyFreshness, calculatedAt: input.calculatedAt });
  const supportResistance = calculateSupportResistance(rows, { symbol: input.symbol, source: input.historySource, freshness: input.historyFreshness, calculatedAt: input.calculatedAt });
  const metric = (key: 'sma' | 'sma50' | 'ema' | 'rsi' | 'macd' | 'atr' | 'averageVolume') =>
    analysis.status === 'available' && analysis.indicators[key].status === 'available' ? analysis.indicators[key].latest.value : null;
  const sma20 = metric('sma');
  const sma50 = metric('sma50');
  const ema20 = metric('ema');
  const averageVolume = metric('averageVolume');
  const midpoint = (fairValue.low + fairValue.high) / 2;
  return {
    status: 'available' as const,
    trendState: sma20 != null && sma50 != null
      ? latest.close > sma20 && sma20 > sma50
        ? 'uptrend-structure'
        : latest.close < sma20 && sma20 < sma50 ? 'downtrend-structure' : 'mixed'
      : 'insufficient-long-term-structure',
    smaEmaStructure: `close=${latest.close}; SMA20=${sma20 ?? 'unavailable'}; SMA50=${sma50 ?? 'unavailable'}; EMA20=${ema20 ?? 'unavailable'}`,
    rsi: metric('rsi'),
    macd: metric('macd'),
    atr: metric('atr'),
    realizedVolatility: Number.isFinite(volatility) ? volatility : null,
    relativeVolume: averageVolume && averageVolume > 0 ? latest.volume / averageVolume : null,
    drawdown: peak > 0 ? latest.close / peak - 1 : 0,
    fiftyTwoWeekHigh: high,
    fiftyTwoWeekLow: low,
    distanceFromHigh: high > 0 ? latest.close / high - 1 : 0,
    distanceFromLow: low > 0 ? latest.close / low - 1 : 0,
    distanceFromFairValueRange: midpoint !== 0 ? latest.close / midpoint - 1 : 0,
    supportResistance,
    source: input.historySource,
    asOf: latest.date,
    limitations: ['Historical market context only; it does not change intrinsic value.', 'No future candles or order book data are used.'],
  };
}
