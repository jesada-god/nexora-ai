import type { FinancialPeriod, QualityCategory, QualityScore, ReliabilityResult } from './types';

const clamp = (value: number) => Math.max(0, Math.min(100, value));
export function fundamentalQuality(periods: readonly FinancialPeriod[]): QualityScore {
  const latest = periods.at(-1); const previous = periods.at(-2);
  const category = (name: string, score: number | null, rawInputs: Record<string, number | null>, formula: string, weight: number, limitation: string): QualityCategory => ({ name, rawInputs, normalizedScore: score == null ? null : clamp(score), formula, weight, missingDataHandling: 'Missing categories are excluded and remaining weights are renormalized; no default score is inserted', limitation });
  const categories = [
    category('Revenue growth consistency', latest && previous && previous.revenue !== 0 ? 50 + ((latest.revenue / previous.revenue - 1) * 200) : null, { latestRevenue: latest?.revenue ?? null, previousRevenue: previous?.revenue ?? null }, 'clamp(50 + YoY growth × 200)', 0.15, 'Two periods do not establish a full cycle'),
    category('Operating margin', latest && latest.revenue ? 50 + (latest.operatingIncome / latest.revenue) * 150 : null, { operatingIncome: latest?.operatingIncome ?? null, revenue: latest?.revenue ?? null }, 'clamp(50 + operating margin × 150)', 0.15, 'Margin norms differ by industry'),
    category('FCF quality', latest && latest.netIncome !== 0 ? 50 + (latest.freeCashFlow / Math.abs(latest.netIncome)) * 25 : null, { freeCashFlow: latest?.freeCashFlow ?? null, netIncome: latest?.netIncome ?? null }, 'clamp(50 + FCF / |net income| × 25)', 0.2, 'Working-capital timing can distort a single period'),
    category('Debt coverage', latest ? latest.totalDebt <= latest.cash ? 100 : latest.operatingIncome > 0 && latest.interestExpense > 0 ? 40 + Math.min(60, latest.operatingIncome / latest.interestExpense * 10) : 20 : null, { debt: latest?.totalDebt ?? null, cash: latest?.cash ?? null, operatingIncome: latest?.operatingIncome ?? null, interestExpense: latest?.interestExpense ?? null }, 'Net-cash=100; otherwise clamp(40 + interest coverage × 10)', 0.2, 'Debt maturities are not represented'),
    category('Cash conversion', latest && latest.operatingCashFlow !== 0 ? 50 + latest.freeCashFlow / Math.abs(latest.operatingCashFlow) * 40 : null, { freeCashFlow: latest?.freeCashFlow ?? null, operatingCashFlow: latest?.operatingCashFlow ?? null }, 'clamp(50 + FCF / |CFO| × 40)', 0.15, 'Capital intensity differs by industry'),
    category('Dilution', latest && previous && previous.dilutedShares > 0 ? 100 - Math.max(0, latest.dilutedShares / previous.dilutedShares - 1) * 500 : null, { latestDilutedShares: latest?.dilutedShares ?? null, previousDilutedShares: previous?.dilutedShares ?? null }, 'clamp(100 - positive dilution rate × 500)', 0.15, 'Buybacks and acquisitions may affect comparability'),
  ];
  const available = categories.filter((c) => c.normalizedScore != null); const totalWeight = available.reduce((sum, c) => sum + c.weight, 0); const score = totalWeight ? available.reduce((sum, c) => sum + c.normalizedScore! * c.weight, 0) / totalWeight : 0;
  return { score, categories, limitation: 'Nexora Fundamental Quality describes normalized historical fundamentals; it is not a price forecast or return probability.' };
}

export function modelReliability(components: { completeness: number; freshness: number; periodConsistency: number; modelCount: number; dispersion: number; cashFlowStability: number; peerSampleSize: number; currencyConsistency: number; sensitivity: number }): ReliabilityResult {
  if (components.completeness <= 0 || components.currencyConsistency <= 0) return { level: 'Unavailable', score: null, components, explanation: 'Nexora Model Reliability is unavailable because essential data quality checks failed.' };
  const countScore = Math.min(100, components.modelCount * 30); const dispersionScore = clamp(100 - components.dispersion * 200); const peerScore = Math.min(100, components.peerSampleSize * 10); const sensitivityScore = clamp(100 - components.sensitivity * 100);
  const score = components.completeness * .2 + components.freshness * .12 + components.periodConsistency * .12 + countScore * .12 + dispersionScore * .15 + components.cashFlowStability * .1 + peerScore * .07 + components.currencyConsistency * .07 + sensitivityScore * .05;
  return { level: score >= 80 ? 'High' : score >= 60 ? 'Moderate' : 'Low', score, components, explanation: 'Nexora Model Reliability measures data and model quality, not the probability of investment returns.' };
}
