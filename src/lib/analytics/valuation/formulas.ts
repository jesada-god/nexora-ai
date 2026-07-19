import type { DcfAssumptions, ModelResult } from './types';

function assertFinite(values: Record<string, number>) { for (const [name, value] of Object.entries(values)) if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`); }
function positive(value: number, name: string) { if (!(value > 0)) throw new RangeError(`${name} must be greater than zero`); }
function assertOrderedScenario(values: { conservative: number; base: number; optimistic: number }) {
  assertFinite(values);
  if (!(values.conservative <= values.base && values.base <= values.optimistic)) throw new RangeError('Scenario values must satisfy conservative <= base <= optimistic');
}

export function normalizeCapitalExpenditure(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('capitalExpenditure must be finite');
  return Math.abs(value);
}

export function enterpriseMultipleValuation(input: {
  model: 'ev-sales' | 'ev-ebitda';
  metric: number;
  totalDebt: number;
  cash: number;
  dilutedShares: number;
  multiples: { conservative: number; base: number; optimistic: number };
}): ModelResult {
  assertFinite({ metric: input.metric, totalDebt: input.totalDebt, cash: input.cash, dilutedShares: input.dilutedShares, ...input.multiples });
  positive(input.metric, input.model === 'ev-sales' ? 'revenue' : 'ebitda');
  positive(input.dilutedShares, 'dilutedShares');
  if (input.totalDebt < 0 || input.cash < 0) throw new RangeError('Debt and cash must be non-negative');
  assertOrderedScenario(input.multiples);
  const value = (multiple: number) => (input.metric * multiple + input.cash - input.totalDebt) / input.dilutedShares;
  const scenarios = {
    conservative: value(input.multiples.conservative),
    base: value(input.multiples.base),
    optimistic: value(input.multiples.optimistic),
  };
  assertOrderedScenario(scenarios);
  if (Object.values(scenarios).some((result) => result <= 0)) throw new RangeError(`${input.model} produced a non-positive per-share value`);
  return {
    model: input.model,
    fairValue: scenarios.base,
    scenarios,
    methodology: `Enterprise value = ${input.model === 'ev-sales' ? 'Revenue' : 'EBITDA'} × target multiple; equity value = enterprise value + cash - debt`,
    inputs: { metric: input.metric, totalDebt: input.totalDebt, cash: input.cash, dilutedShares: input.dilutedShares },
    assumptions: { conservativeMultiple: input.multiples.conservative, baseMultiple: input.multiples.base, optimisticMultiple: input.multiples.optimistic, assumptionSource: 'nexora-sector-valuation-v1 model assumption' },
    limitations: ['Target multiples are versioned model assumptions, not provider observations or a fabricated peer average.'],
  };
}

export function priceMultipleValuation(input: {
  model: 'pe' | 'pb';
  metricPerShare: number;
  multiples: { conservative: number; base: number; optimistic: number };
}): ModelResult {
  assertFinite({ metricPerShare: input.metricPerShare, ...input.multiples });
  positive(input.metricPerShare, input.model === 'pe' ? 'eps' : 'bookValuePerShare');
  assertOrderedScenario(input.multiples);
  const scenarios = {
    conservative: input.metricPerShare * input.multiples.conservative,
    base: input.metricPerShare * input.multiples.base,
    optimistic: input.metricPerShare * input.multiples.optimistic,
  };
  assertOrderedScenario(scenarios);
  return {
    model: input.model,
    fairValue: scenarios.base,
    scenarios,
    methodology: `${input.model === 'pe' ? 'EPS' : 'Book value per share'} × target multiple`,
    inputs: { metricPerShare: input.metricPerShare },
    assumptions: { conservativeMultiple: input.multiples.conservative, baseMultiple: input.multiples.base, optimisticMultiple: input.multiples.optimistic, assumptionSource: 'nexora-sector-valuation-v1 model assumption' },
    limitations: ['Target multiples are versioned model assumptions and are disclosed separately from provider data.'],
  };
}

export function pegValuation(input: {
  eps: number;
  forwardGrowthDecimal: number;
  targetPeg: { conservative: number; base: number; optimistic: number };
}): ModelResult {
  assertFinite({ eps: input.eps, forwardGrowthDecimal: input.forwardGrowthDecimal, ...input.targetPeg });
  positive(input.eps, 'eps'); positive(input.forwardGrowthDecimal, 'forwardGrowthDecimal');
  assertOrderedScenario(input.targetPeg);
  const growthPercentPoints = input.forwardGrowthDecimal * 100;
  const value = (targetPeg: number) => input.eps * targetPeg * growthPercentPoints;
  const scenarios = { conservative: value(input.targetPeg.conservative), base: value(input.targetPeg.base), optimistic: value(input.targetPeg.optimistic) };
  assertOrderedScenario(scenarios);
  return {
    model: 'peg',
    fairValue: scenarios.base,
    scenarios,
    methodology: 'Target P/E = target PEG × forward EPS growth in percentage points; fair value = EPS × target P/E',
    inputs: { eps: input.eps, forwardGrowthDecimal: input.forwardGrowthDecimal, growthPercentPoints },
    assumptions: { conservativeTargetPeg: input.targetPeg.conservative, baseTargetPeg: input.targetPeg.base, optimisticTargetPeg: input.targetPeg.optimistic, growthUnit: 'decimal input converted once to percentage points' },
    limitations: ['PEG is used only when a real provider forward-growth estimate is present.'],
  };
}

export interface DcfInput { revenue: number; netDebt: number; dilutedShares: number; assumptions: DcfAssumptions; }
export function fcffDcf(input: DcfInput): ModelResult {
  const a = input.assumptions;
  assertFinite({ revenue: input.revenue, netDebt: input.netDebt, dilutedShares: input.dilutedShares, ...a });
  positive(input.revenue, 'revenue'); positive(input.dilutedShares, 'dilutedShares');
  if (!Number.isInteger(a.forecastHorizon) || a.forecastHorizon < 1 || a.forecastHorizon > 10) throw new RangeError('forecastHorizon must be an integer from 1 to 10');
  if (a.wacc <= a.terminalGrowth) throw new RangeError('WACC must be greater than terminal growth');
  if (a.wacc <= 0 || a.wacc > 0.5 || a.terminalGrowth < -0.1 || a.terminalGrowth > 0.1 || a.taxRate < 0 || a.taxRate > 0.6 || a.operatingMargin < -1 || a.operatingMargin > 1) throw new RangeError('DCF assumptions are outside supported bounds');
  let revenue = input.revenue; let pvFcff = 0; let finalFcff = 0;
  for (let year = 1; year <= a.forecastHorizon; year += 1) {
    revenue *= 1 + a.revenueGrowth;
    const nopat = revenue * a.operatingMargin * (1 - a.taxRate);
    finalFcff = nopat + revenue * a.depreciationPercentRevenue - revenue * a.capexPercentRevenue - revenue * a.workingCapitalPercentRevenue;
    pvFcff += finalFcff / ((1 + a.wacc) ** year);
  }
  const terminalValue = finalFcff * (1 + a.terminalGrowth) / (a.wacc - a.terminalGrowth);
  const enterpriseValue = pvFcff + terminalValue / ((1 + a.wacc) ** a.forecastHorizon);
  const shares = input.dilutedShares * ((1 + a.dilutionRate) ** a.forecastHorizon);
  const fairValue = (enterpriseValue - input.netDebt) / shares;
  if (!Number.isFinite(fairValue)) throw new RangeError('DCF result is not finite');
  return { model: 'fcff-dcf', fairValue, methodology: 'Forecast FCFF = NOPAT + D&A - CapEx - change in working capital; discount at WACC; Gordon terminal value', inputs: { revenue: input.revenue, netDebt: input.netDebt, dilutedShares: input.dilutedShares, pvFcff, terminalValue, enterpriseValue }, assumptions: { ...a }, limitations: ['Constant forecast growth and margin within each scenario', 'Terminal value can be highly sensitive to WACC and terminal growth'] };
}

export function fcfeValuation(input: { currentFcfe: number; costOfEquity: number; growth: number; dilutedShares: number }): ModelResult {
  assertFinite(input); positive(input.dilutedShares, 'dilutedShares');
  if (input.costOfEquity <= input.growth) throw new RangeError('Cost of equity must be greater than growth');
  const equityValue = input.currentFcfe * (1 + input.growth) / (input.costOfEquity - input.growth);
  return { model: 'fcfe', fairValue: equityValue / input.dilutedShares, methodology: 'Single-stage FCFE discounted at cost of equity', inputs: { currentFcfe: input.currentFcfe, dilutedShares: input.dilutedShares }, assumptions: { costOfEquity: input.costOfEquity, growth: input.growth }, limitations: ['Requires stable equity cash flow and financing policy'] };
}

export function dividendDiscount(input: { dividendPerShare: number; costOfEquity: number; growth: number }): ModelResult {
  assertFinite(input);
  if (input.dividendPerShare <= 0) throw new RangeError('Dividend history is required');
  if (input.costOfEquity <= input.growth) throw new RangeError('Cost of equity must be greater than growth');
  return { model: 'ddm', fairValue: input.dividendPerShare * (1 + input.growth) / (input.costOfEquity - input.growth), methodology: 'Gordon growth dividend discount model', inputs: { dividendPerShare: input.dividendPerShare }, assumptions: { costOfEquity: input.costOfEquity, growth: input.growth }, limitations: ['Applicable only to stable dividend policies'] };
}

export function median(values: readonly number[]): number { const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b); if (!sorted.length) throw new RangeError('At least one finite value is required'); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
export function relativeValuation(input: { metricPerShare: number; peerMultiples: Array<{ symbol: string; multiple: number }>; outlierIqrFactor?: number }): ModelResult {
  assertFinite({ metricPerShare: input.metricPerShare });
  const clean = input.peerMultiples.filter((peer) => Number.isFinite(peer.multiple) && peer.multiple > 0);
  if (clean.length < 3) throw new RangeError('At least three valid peers are required');
  const initialMedian = median(clean.map((peer) => peer.multiple));
  const extremeFiltered = clean.filter((peer) => peer.multiple >= initialMedian / 5 && peer.multiple <= initialMedian * 5);
  const sorted = extremeFiltered.map((peer) => peer.multiple).toSorted((a, b) => a - b); const q1 = median(sorted.slice(0, Math.floor(sorted.length / 2))); const q3 = median(sorted.slice(Math.ceil(sorted.length / 2))); const factor = input.outlierIqrFactor ?? 1.5; const iqr = q3 - q1;
  const retained = extremeFiltered.filter((peer) => peer.multiple >= q1 - factor * iqr && peer.multiple <= q3 + factor * iqr); const baseline = median(retained.map((peer) => peer.multiple));
  return { model: 'relative', fairValue: input.metricPerShare * baseline, methodology: 'Median peer multiple after transparent extreme-ratio guard and IQR outlier filtering', inputs: { metricPerShare: input.metricPerShare, peerCount: clean.length, retainedPeerCount: retained.length, peers: retained.map((peer) => peer.symbol).join(',') }, assumptions: { medianMultiple: baseline, extremeRatioLimit: 5, outlierIqrFactor: factor }, limitations: ['Peer comparability and market pricing affect the result'] };
}

export function assetBasedValuation(input: { totalAssets: number; totalLiabilities: number; dilutedShares: number; adjustment: number }): ModelResult {
  assertFinite(input); positive(input.dilutedShares, 'dilutedShares');
  return { model: 'asset-based', fairValue: (input.totalAssets * input.adjustment - input.totalLiabilities) / input.dilutedShares, methodology: 'Adjusted net asset value / diluted shares', inputs: { totalAssets: input.totalAssets, totalLiabilities: input.totalLiabilities, dilutedShares: input.dilutedShares }, assumptions: { assetAdjustment: input.adjustment }, limitations: ['Book values may not equal realizable values'] };
}

export function compositeValuation(models: readonly ModelResult[], rawWeights: Record<string, number>) {
  const weighted = models.map((model) => ({ ...model, rawWeight: rawWeights[model.model] ?? 0 })).filter((model) => Number.isFinite(model.fairValue) && Number.isFinite(model.rawWeight) && model.rawWeight > 0);
  const total = weighted.reduce((sum, model) => sum + model.rawWeight, 0); if (!total) throw new RangeError('At least one validated model weight is required');
  const normalized = weighted.map(({ rawWeight, ...model }) => ({ ...model, configuredWeight: rawWeight, normalizedWeight: rawWeight / total, weight: rawWeight / total }));
  const centralEstimate = normalized.reduce((sum, model) => sum + model.fairValue * model.weight, 0); const dispersion = Math.sqrt(normalized.reduce((sum, model) => sum + model.weight * ((model.fairValue - centralEstimate) ** 2), 0)) / Math.max(Math.abs(centralEstimate), Number.EPSILON);
  return { centralEstimate, dispersion, models: normalized };
}

export function dcfSensitivity(input: DcfInput, waccValues: readonly number[], terminalGrowthValues: readonly number[]) {
  if (!waccValues.length || !terminalGrowthValues.length || waccValues.length > 9 || terminalGrowthValues.length > 9) throw new RangeError('Sensitivity axes must contain 1 to 9 values');
  return waccValues.map((wacc) => terminalGrowthValues.map((terminalGrowth) => {
    try { return { wacc, terminalGrowth, status: 'available' as const, fairValue: fcffDcf({ ...input, assumptions: { ...input.assumptions, wacc, terminalGrowth } }).fairValue }; }
    catch (cause) { return { wacc, terminalGrowth, status: 'unavailable' as const, reason: cause instanceof Error ? cause.message : 'Invalid sensitivity input' }; }
  }));
}

export function capitalStructureSensitivity(input: DcfInput, netDebtValues: readonly number[], dilutionRates: readonly number[]) {
  if (netDebtValues.length * dilutionRates.length > 81) throw new RangeError('Sensitivity workload exceeds 81 cells');
  return netDebtValues.map((netDebt) => dilutionRates.map((dilutionRate) => ({ netDebt, dilutionRate, fairValue: fcffDcf({ ...input, netDebt, assumptions: { ...input.assumptions, dilutionRate } }).fairValue })));
}
