import { dividendDiscount, enterpriseMultipleValuation, fcffDcf, pegValuation, priceMultipleValuation } from './formulas';
import { selectSectorValuationRule, type SectorValuationRule } from './sector-rules';
import {
  SECTOR_RULE_VERSION,
  type DcfAssumptions,
  type ExcludedModel,
  type ModelId,
  type ModelResult,
  type ValuationAssumptionDisclosure,
  type ValuationInput,
} from './types';

export interface SectorModelSelection {
  rule: SectorValuationRule;
  models: ModelResult[];
  excludedModels: ExcludedModel[];
  assumptions: ValuationAssumptionDisclosure[];
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function derivedDcfAssumptions(input: ValuationInput, rule: SectorValuationRule): DcfAssumptions | null {
  if (input.assumptions) return input.assumptions;
  const latest = input.periods.at(-1);
  const earliest = input.periods.at(0);
  if (!latest || !earliest || input.periods.length < 3 || latest.revenue <= 0 || earliest.revenue <= 0 || !finite(latest.changeInWorkingCapital)) return null;
  const years = Math.max(1, input.periods.length - 1);
  const revenueGrowth = clamp((latest.revenue / earliest.revenue) ** (1 / years) - 1, -0.1, 0.2);
  const operatingMargin = latest.operatingIncome / latest.revenue;
  const depreciationPercentRevenue = latest.depreciationAmortization / latest.revenue;
  const capexPercentRevenue = Math.abs(latest.capitalExpenditure) / latest.revenue;
  const workingCapitalPercentRevenue = latest.changeInWorkingCapital / latest.revenue;
  const previousShares = input.periods.at(-2)?.dilutedShares;
  const dilutionRate = previousShares && previousShares > 0 ? clamp(latest.dilutedShares / previousShares - 1, 0, 0.2) : 0;
  const assumptions = {
    forecastHorizon: 5,
    revenueGrowth,
    operatingMargin,
    taxRate: 0.21,
    depreciationPercentRevenue,
    capexPercentRevenue,
    workingCapitalPercentRevenue,
    wacc: rule.assumptions.wacc,
    terminalGrowth: rule.assumptions.terminalGrowth,
    dilutionRate,
  };
  return Object.values(assumptions).every(Number.isFinite) && operatingMargin > 0 ? assumptions : null;
}

function withDcfScenarios(input: ValuationInput, assumptions: DcfAssumptions): ModelResult {
  const latest = input.periods.at(-1)!;
  const baseInput = { revenue: latest.revenue, netDebt: latest.totalDebt - latest.cash, dilutedShares: latest.dilutedShares };
  const conservativeAssumptions = {
    ...assumptions,
    revenueGrowth: Math.max(-0.2, assumptions.revenueGrowth - 0.02),
    wacc: assumptions.wacc + 0.01,
    terminalGrowth: assumptions.terminalGrowth - 0.005,
  };
  const optimisticWacc = Math.max(0.01, assumptions.wacc - 0.01);
  const optimisticAssumptions = {
    ...assumptions,
    revenueGrowth: Math.min(0.3, assumptions.revenueGrowth + 0.02),
    wacc: optimisticWacc,
    terminalGrowth: Math.min(optimisticWacc - 0.005, assumptions.terminalGrowth + 0.005),
  };
  const conservative = fcffDcf({ ...baseInput, assumptions: conservativeAssumptions });
  const base = fcffDcf({ ...baseInput, assumptions });
  const optimistic = fcffDcf({ ...baseInput, assumptions: optimisticAssumptions });
  const scenarios = { conservative: conservative.fairValue, base: base.fairValue, optimistic: optimistic.fairValue };
  if (!(scenarios.conservative <= scenarios.base && scenarios.base <= scenarios.optimistic)) throw new RangeError('DCF scenarios are not monotonic');
  if (Object.values(scenarios).some((value) => !Number.isFinite(value) || value <= 0)) throw new RangeError('DCF scenarios must be finite and positive');
  return { ...base, fairValue: scenarios.base, scenarios, reason: 'Positive, meaningful FCF history and complete debt, cash, shares, and currency inputs passed validation.' };
}

function withDdmScenarios(input: ValuationInput, rule: SectorValuationRule): ModelResult {
  const latest = input.periods.at(-1)!;
  const dividendRows = input.periods.filter((period) => finite(period.dividendsPaid) && period.dividendsPaid < 0);
  if (dividendRows.length < 3) throw new RangeError('At least three real dividend periods are required');
  const dividendPerShare = Math.abs(latest.dividendsPaid ?? 0) / latest.dilutedShares;
  const baseGrowth = rule.assumptions.terminalGrowth;
  const cost = rule.assumptions.costOfEquity;
  const conservative = dividendDiscount({ dividendPerShare, costOfEquity: cost + 0.01, growth: Math.max(0, baseGrowth - 0.005) });
  const base = dividendDiscount({ dividendPerShare, costOfEquity: cost, growth: baseGrowth });
  const optimistic = dividendDiscount({ dividendPerShare, costOfEquity: cost - 0.005, growth: Math.min(cost - 0.01, baseGrowth + 0.005) });
  const scenarios = { conservative: conservative.fairValue, base: base.fairValue, optimistic: optimistic.fairValue };
  if (!(scenarios.conservative <= scenarios.base && scenarios.base <= scenarios.optimistic)) throw new RangeError('DDM scenarios are not monotonic');
  return { ...base, scenarios, reason: 'Verified multi-period dividend history passed the DDM gate.' };
}

function invalid(model: ModelId, reason: string): ExcludedModel {
  return { model, reason };
}

export function selectSectorModels(input: ValuationInput): SectorModelSelection {
  const rule = selectSectorValuationRule(input.sector, input.industry);
  const latest = input.periods.at(-1);
  const models: ModelResult[] = [];
  const excludedModels: ExcludedModel[] = [];
  const assumptions: ValuationAssumptionDisclosure[] = [
    { field: 'sectorRuleId', value: rule.ruleId, source: 'model-assumption', ruleVersion: SECTOR_RULE_VERSION },
    { field: 'WACC', value: rule.assumptions.wacc, source: 'model-assumption', ruleVersion: SECTOR_RULE_VERSION },
    { field: 'Terminal Growth', value: rule.assumptions.terminalGrowth, source: 'model-assumption', ruleVersion: SECTOR_RULE_VERSION },
  ];
  if (!latest) return { rule, models, excludedModels: [invalid('fcff-dcf', 'No normalized financial period is available')], assumptions };

  const financialInstitution = /financial|bank|insurance/.test(`${input.sector} ${input.industry}`.toLowerCase());
  const preRevenueBiotech = /biotech/.test(input.industry.toLowerCase()) && latest.revenue <= 0;
  const validFcfRows = input.periods.filter((period) => period.freeCashFlow > 0);
  const dcfAssumptions = derivedDcfAssumptions(input, rule);
  const equity = finite(latest.totalEquity) ? latest.totalEquity : latest.totalAssets - latest.totalLiabilities;
  const ebitda = finite(latest.ebitda) ? latest.ebitda : latest.operatingIncome + latest.depreciationAmortization;
  const eps = finite(latest.dilutedEps) ? latest.dilutedEps : null;

  for (const model of rule.preferredModels) {
    try {
      if (preRevenueBiotech) throw new RangeError('Pre-revenue biotechnology requires a dedicated pipeline model; no probability or pipeline value is invented');
      if (!(latest.dilutedShares > 0)) throw new RangeError('Diluted shares must be greater than zero');
      if (model === 'fcff-dcf') {
        if (financialInstitution) throw new RangeError('FCFF for a general operating company is not valid for Financials');
        if (input.periods.length < 3 || validFcfRows.length < 2 || latest.freeCashFlow <= 0) throw new RangeError('DCF requires at least three periods and meaningful positive FCF');
        if (!dcfAssumptions) throw new RangeError('DCF assumptions cannot be derived from verified history');
        if (dcfAssumptions.wacc <= dcfAssumptions.terminalGrowth) throw new RangeError('WACC must be greater than terminal growth');
        models.push(withDcfScenarios(input, dcfAssumptions));
      } else if (model === 'ev-sales') {
        if (financialInstitution) throw new RangeError('EV/Sales is not used for Financials');
        if (!(latest.revenue > 0)) throw new RangeError('Revenue must be greater than zero');
        if (!(finite(input.marketCapitalization) && input.marketCapitalization > 0)) throw new RangeError('Real market capitalization is required by the EV/Sales gate');
        const multiples = rule.assumptions.relativeMultiples['ev-sales'];
        if (!multiples) throw new RangeError('No versioned EV/Sales assumption is configured');
        models.push({ ...enterpriseMultipleValuation({ model, metric: latest.revenue, totalDebt: latest.totalDebt, cash: latest.cash, dilutedShares: latest.dilutedShares, multiples }), reason: eps !== null && eps <= 0 ? 'EPS is non-positive, so P/E and PEG are excluded; EV/Sales remains meaningful.' : 'Revenue, enterprise-value inputs, and shares passed validation.' });
      } else if (model === 'ev-ebitda') {
        if (financialInstitution) throw new RangeError('EV/EBITDA is not used for Financials');
        if (!(ebitda > 0)) throw new RangeError('EBITDA must be greater than zero');
        if (!(finite(input.marketCapitalization) && input.marketCapitalization > 0)) throw new RangeError('Real market capitalization is required by the EV/EBITDA gate');
        const multiples = rule.assumptions.relativeMultiples['ev-ebitda'];
        if (!multiples) throw new RangeError('No versioned EV/EBITDA assumption is configured');
        models.push({ ...enterpriseMultipleValuation({ model, metric: ebitda, totalDebt: latest.totalDebt, cash: latest.cash, dilutedShares: latest.dilutedShares, multiples }), reason: 'Positive EBITDA and complete enterprise-value inputs passed validation.' });
      } else if (model === 'pe') {
        if (!(eps !== null && eps > 0)) throw new RangeError('P/E requires provider-supplied diluted EPS greater than zero');
        const multiples = rule.assumptions.relativeMultiples.pe;
        if (!multiples) throw new RangeError('No versioned P/E assumption is configured');
        models.push({ ...priceMultipleValuation({ model, metricPerShare: eps, multiples }), reason: 'Provider-supplied diluted EPS is positive.' });
      } else if (model === 'peg') {
        if (!(eps !== null && eps > 0)) throw new RangeError('PEG requires provider-supplied diluted EPS greater than zero');
        if (!(input.forwardEpsGrowth && input.forwardEpsGrowth.value > 0)) throw new RangeError('PEG requires a real provider forward EPS growth estimate');
        const multiples = rule.assumptions.relativeMultiples.peg;
        if (!multiples) throw new RangeError('No versioned PEG assumption is configured');
        models.push({ ...pegValuation({ eps, forwardGrowthDecimal: input.forwardEpsGrowth.value, targetPeg: multiples }), reason: 'Positive EPS and a real provider forward EPS growth estimate passed validation.' });
      } else if (model === 'pb') {
        if (!(equity > 0)) throw new RangeError('Total equity must be greater than zero');
        const multiples = rule.assumptions.relativeMultiples.pb;
        if (!multiples) throw new RangeError('No versioned P/B assumption is configured');
        models.push({ ...priceMultipleValuation({ model, metricPerShare: equity / latest.dilutedShares, multiples }), reason: 'Positive book equity and diluted shares passed validation.' });
      } else if (model === 'ddm') {
        models.push(withDdmScenarios(input, rule));
      }
    } catch (cause) {
      excludedModels.push(invalid(model, cause instanceof Error ? cause.message : 'Model validation failed'));
    }
  }

  for (const [model, multiples] of Object.entries(rule.assumptions.relativeMultiples)) {
    if (multiples) {
      assumptions.push({ field: `${model} scenario multiples`, value: `${multiples.conservative}/${multiples.base}/${multiples.optimistic}`, source: 'model-assumption', ruleVersion: SECTOR_RULE_VERSION });
    }
  }
  if (dcfAssumptions) {
    assumptions.push(
      { field: 'Revenue Growth', value: dcfAssumptions.revenueGrowth, source: input.assumptions ? 'model-assumption' : 'historical-derived', ruleVersion: SECTOR_RULE_VERSION },
      { field: 'Operating Margin', value: dcfAssumptions.operatingMargin, source: input.assumptions ? 'model-assumption' : 'historical-derived', ruleVersion: SECTOR_RULE_VERSION },
      { field: 'Tax Rate', value: dcfAssumptions.taxRate, source: 'model-assumption', ruleVersion: SECTOR_RULE_VERSION },
    );
  }
  return { rule, models, excludedModels, assumptions };
}
