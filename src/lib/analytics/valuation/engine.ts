import { calculateTechnicalAnalysis } from '../technical/calculations';
import { calculateSupportResistance } from '../support-resistance/calculations';
import { classifyCompany } from './classification';
import { compositeValuation } from './formulas';
import { fundamentalQuality, modelReliability } from './quality';
import { createFairValueUnavailable } from './result';
import { selectSectorModels } from './sector-selection';
import {
  METHODOLOGY_VERSION,
  SECTOR_RULE_VERSION,
  type FairValueResult,
  type FinancialPeriod,
  type ModelResult,
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
    || (['dividendsPaid', 'grossProfit', 'ebitda', 'dilutedEps', 'totalEquity', 'changeInWorkingCapital'].includes(key) && (value === null || value === undefined))
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

/** Relative multiples that rest on a versioned assumption, not intrinsic cash flows. */
const RELATIVE_ASSUMPTION_MODELS = new Set<ModelResult['model']>(['ev-sales', 'ev-ebitda', 'pe', 'peg', 'pb']);

/** Count of finite, positive, verifiable peer multiples actually supplied (never fabricated). */
export function verifiablePeerCount(input: Partial<ValuationInput>): number {
  return (input.peerMultiples ?? []).filter((peer) => Number.isFinite(peer.multiple) && peer.multiple > 0).length;
}

/**
 * Refuses to publish a valuation that would rest ONLY on a versioned assumption
 * multiple (EV/Sales) for a growth / pre-profit company, when no verifiable peer
 * set (>= 5) and no forward/NTM revenue exist to justify a growth multiple.
 *
 * This is the direct fix for the RKLB `$3.92 / -94%` incident: negative
 * EPS/EBITDA/FCF correctly exclude P/E, PEG, EV/EBITDA and DCF, leaving EV/Sales
 * as the SOLE survivor — i.e. a model selected only because it is the one left.
 * Applying a mature-sector multiple to trailing revenue then produces a
 * misleadingly precise point estimate. Rather than fabricate peers or a forward
 * revenue, we surface an honest "cannot value reliably yet" with the exact
 * missing inputs. A future real peer-data source (>= 5 peers) or a provider
 * forward revenue lifts the gate automatically.
 */
export function meaningfulModelGate(
  input: Pick<ValuationInput, 'periods' | 'peerMultiples' | 'forwardRevenue'>,
  models: readonly ModelResult[],
): { ok: true } | { ok: false; reason: string; missingFields: string[] } {
  const soleAssumptionRelative = models.length === 1 && RELATIVE_ASSUMPTION_MODELS.has(models[0].model);
  if (!soleAssumptionRelative) return { ok: true };
  const latest = input.periods.at(-1);
  const preProfit = !!latest && (
    latest.netIncome <= 0
    || latest.freeCashFlow <= 0
    || (finite(latest.dilutedEps) && latest.dilutedEps <= 0)
  );
  if (!preProfit) return { ok: true };
  const hasPeers = verifiablePeerCount(input) >= 5;
  const hasForwardRevenue = !!input.forwardRevenue && Number.isFinite(input.forwardRevenue.value) && input.forwardRevenue.value > 0;
  if (hasPeers || hasForwardRevenue) return { ok: true };
  return {
    ok: false,
    reason: 'ประเมินจาก EV/Sales เพียงตัวเดียวโดยใช้ multiple สมมติ และบริษัทยังขาดทุน จึงไม่มี peer set (>=5) หรือ forward revenue ที่ระบุงวดมายืนยัน multiple การเติบโต — ไม่เผยแพร่ค่าประเมินที่ดูแม่นยำเกินจริง',
    missingFields: ['verifiablePeerSet>=5', 'forwardRevenueWithPeriod'],
  };
}

export function calculateFairValue(input: ValuationInput, now = Date.now()): FairValueResult {
  const calculatedAt = input.calculatedAt ?? new Date(now).toISOString();
  const gate = dataSufficiency(input, now);
  if (!gate.ok) {
    return createFairValueUnavailable({
      failureKind: gate.missingInputs.includes('historicalFinancials>=3Periods') ? 'insufficient-periods' : gate.missingInputs.includes('currencyNormalization') ? 'currency-mismatch' : 'missing-field',
      symbol: input.symbol,
      currency: input.currency || null,
      provider: input.source || null,
      reason: 'ข้อมูลจริงไม่เพียงพอหรือไม่ผ่าน Data Sufficiency Gate จึงไม่สร้าง Fair Value',
      missingFields: gate.missingInputs,
      staleInputs: gate.staleInputs,
      asOf: input.priceAsOf || calculatedAt,
      calculatedAt,
      limitations: ['No defaults or synthetic financial statements are inserted.'],
    });
  }

  const selection = selectSectorModels(input);
  const meaningful = meaningfulModelGate(input, selection.models);
  if (!meaningful.ok) {
    return createFairValueUnavailable({
      failureKind: 'missing-field',
      symbol: input.symbol,
      currency: input.currency,
      provider: input.source,
      reason: meaningful.reason,
      missingFields: meaningful.missingFields,
      staleInputs: gate.staleInputs,
      asOf: input.priceAsOf,
      calculatedAt,
      limitations: [
        'A model is never forced onto an unsuitable company.',
        'ค่าประเมินจะไม่ถูกเผยแพร่หากอ้างอิงเพียง multiple สมมติโดยไม่มี peer set ที่ตรวจสอบได้',
      ],
    });
  }
  if (!selection.models.length) {
    return createFairValueUnavailable({
      failureKind: 'missing-field',
      symbol: input.symbol,
      currency: input.currency,
      provider: input.source,
      reason: 'ข้อมูลจริงผ่านเกณฑ์พื้นฐาน แต่ไม่มี valuation model ที่มีความหมายและผ่าน validation สำหรับบริษัทนี้',
      missingFields: selection.excludedModels.map((item) => `${item.model}: ${item.reason}`),
      staleInputs: gate.staleInputs,
      asOf: input.priceAsOf,
      calculatedAt,
      limitations: ['A model is never forced onto an unsuitable company.'],
    });
  }

  const baseClassification = classifyCompany(input.sector, input.industry, input.periods);
  const classification = {
    ...baseClassification,
    eligibleModels: selection.models.map((model) => model.model),
    excludedModels: selection.excludedModels,
    evidence: [
      ...baseClassification.evidence,
      `Company stage (${selection.stage.stage}): ${selection.stage.reason}`,
      `Sector rule ${selection.rule.ruleId} selected from fundamentals-gated sector/industry`,
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
  const peerSampleSize = verifiablePeerCount(input);
  const reliabilityRaw = modelReliability({
    completeness,
    freshness,
    periodConsistency,
    modelCount: composite.models.length,
    dispersion: composite.dispersion,
    cashFlowStability: Math.min(100, quality.score),
    peerSampleSize,
    currencyConsistency,
    sensitivity: uncertainty,
  });
  // A single relative multiple resting on a versioned ASSUMPTION with no
  // verifiable peer set is not a Moderate/High-confidence estimate no matter how
  // complete the statements are — the multiple itself is unvalidated. Cap it to
  // Low so the header never overstates confidence ("ห้าม hardcode ปานกลาง"). This
  // only bites the assumption-only single-model case; blended/peer-backed and
  // cash-flow-anchored (DCF/DDM) valuations keep their computed level.
  const singleAssumptionMultiple = composite.models.length === 1
    && RELATIVE_ASSUMPTION_MODELS.has(composite.models[0].model)
    && peerSampleSize < 5;
  const reliability = singleAssumptionMultiple && (reliabilityRaw.level === 'High' || reliabilityRaw.level === 'Moderate')
    ? {
        ...reliabilityRaw,
        level: 'Low' as const,
        explanation: `${reliabilityRaw.explanation} ระดับถูกจำกัดที่ Low เพราะใช้ multiple สมมติเพียงตัวเดียวและไม่มี peer set ที่ตรวจสอบได้ (>=5).`,
      }
    : reliabilityRaw;

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
    return createFairValueUnavailable({
      failureKind: 'calculation-error',
      symbol: input.symbol,
      currency: input.currency,
      provider: input.source,
      reason: 'Scenario validation failed; Fair Value was not published.',
      missingFields: ['conservative<=base<=optimistic'],
      staleInputs: gate.staleInputs,
      asOf: input.priceAsOf,
      calculatedAt,
      limitations: ['Scenario results are validated, never silently sorted.'],
    });
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
    // Revenue basis is truthfully the latest completed fiscal period (trailing annual),
    // never a forward/NTM estimate — no analyst-estimate source is used here.
    ...(composite.models.some((model) => model.model === 'ev-sales' || model.model === 'fcff-dcf') ? [detail('Revenue (trailing, latest FY)', latest.revenue, 'USD')] : []),
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
    relativeVolume: averageVolume && averageVolume > 0 && latest.volume != null ? latest.volume / averageVolume : null,
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
