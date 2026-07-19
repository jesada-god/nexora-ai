import { SECTOR_RULE_VERSION, type ModelId } from './types';

export interface ScenarioMultiple {
  conservative: number;
  base: number;
  optimistic: number;
}

export interface SectorValuationRule {
  ruleId: string;
  sectors: string[];
  industryKeywords?: string[];
  preferredModels: ModelId[];
  modelWeights: Partial<Record<ModelId, number>>;
  assumptions: {
    wacc: number;
    terminalGrowth: number;
    costOfEquity: number;
    relativeMultiples: Partial<Record<'ev-sales' | 'ev-ebitda' | 'pe' | 'peg' | 'pb', ScenarioMultiple>>;
  };
}

export const SECTOR_VALUATION_RULE_VERSION = SECTOR_RULE_VERSION;

const highGrowthIndustries = [
  'aerospace defense',
  'space',
  'semiconductor',
  'software infrastructure',
  'biotechnology',
  'advanced manufacturing',
];

/**
 * These values are explicitly versioned Nexora model assumptions. They are
 * never labelled as provider observations or peer averages in the response.
 */
export const SECTOR_VALUATION_RULES: readonly SectorValuationRule[] = [
  {
    ruleId: 'financials-v1',
    sectors: ['financial services', 'financials'],
    preferredModels: ['pb', 'ddm'],
    modelWeights: { pb: 0.7, ddm: 0.3 },
    assumptions: {
      wacc: 0.09,
      terminalGrowth: 0.02,
      costOfEquity: 0.1,
      relativeMultiples: { pb: { conservative: 0.8, base: 1, optimistic: 1.2 } },
    },
  },
  {
    ruleId: 'reit-v1',
    sectors: ['real estate'],
    industryKeywords: ['reit', 'real estate investment trust'],
    preferredModels: ['pb', 'ddm'],
    modelWeights: { pb: 0.65, ddm: 0.35 },
    assumptions: {
      wacc: 0.085,
      terminalGrowth: 0.018,
      costOfEquity: 0.095,
      relativeMultiples: { pb: { conservative: 0.75, base: 0.95, optimistic: 1.15 } },
    },
  },
  {
    ruleId: 'high-growth-industry-v1',
    sectors: [],
    industryKeywords: highGrowthIndustries,
    preferredModels: ['ev-sales', 'ev-ebitda', 'pe', 'peg', 'fcff-dcf'],
    modelWeights: { 'ev-sales': 0.5, 'ev-ebitda': 0.2, pe: 0.1, peg: 0.1, 'fcff-dcf': 0.1 },
    assumptions: {
      wacc: 0.105,
      terminalGrowth: 0.025,
      costOfEquity: 0.115,
      relativeMultiples: {
        'ev-sales': { conservative: 1.5, base: 2.5, optimistic: 3.5 },
        'ev-ebitda': { conservative: 8, base: 11, optimistic: 14 },
        pe: { conservative: 18, base: 25, optimistic: 32 },
        peg: { conservative: 0.8, base: 1, optimistic: 1.2 },
      },
    },
  },
  {
    ruleId: 'technology-communications-v1',
    sectors: ['technology', 'communication services'],
    preferredModels: ['peg', 'pe', 'ev-sales', 'ev-ebitda', 'fcff-dcf'],
    modelWeights: { peg: 0.2, pe: 0.2, 'ev-sales': 0.25, 'ev-ebitda': 0.15, 'fcff-dcf': 0.2 },
    assumptions: {
      wacc: 0.095,
      terminalGrowth: 0.025,
      costOfEquity: 0.105,
      relativeMultiples: {
        'ev-sales': { conservative: 2, base: 3, optimistic: 4 },
        'ev-ebitda': { conservative: 9, base: 12, optimistic: 15 },
        pe: { conservative: 18, base: 24, optimistic: 30 },
        peg: { conservative: 0.8, base: 1, optimistic: 1.2 },
      },
    },
  },
  {
    ruleId: 'industrials-v1',
    sectors: ['industrials'],
    preferredModels: ['ev-ebitda', 'ev-sales', 'pb', 'fcff-dcf'],
    modelWeights: { 'ev-ebitda': 0.3, 'ev-sales': 0.35, pb: 0.15, 'fcff-dcf': 0.2 },
    assumptions: {
      wacc: 0.09,
      terminalGrowth: 0.02,
      costOfEquity: 0.1,
      relativeMultiples: {
        'ev-sales': { conservative: 0.9, base: 1.4, optimistic: 1.9 },
        'ev-ebitda': { conservative: 6, base: 8, optimistic: 10 },
        pb: { conservative: 1, base: 1.4, optimistic: 1.8 },
      },
    },
  },
  {
    ruleId: 'consumer-staples-v1',
    sectors: ['consumer defensive', 'consumer staples'],
    preferredModels: ['fcff-dcf', 'pe', 'ddm', 'ev-ebitda'],
    modelWeights: { 'fcff-dcf': 0.35, pe: 0.25, ddm: 0.15, 'ev-ebitda': 0.25 },
    assumptions: {
      wacc: 0.08,
      terminalGrowth: 0.02,
      costOfEquity: 0.09,
      relativeMultiples: {
        'ev-ebitda': { conservative: 7, base: 9, optimistic: 11 },
        pe: { conservative: 15, base: 19, optimistic: 23 },
      },
    },
  },
  {
    ruleId: 'utilities-v1',
    sectors: ['utilities'],
    preferredModels: ['fcff-dcf', 'ddm', 'pe', 'ev-ebitda'],
    modelWeights: { 'fcff-dcf': 0.35, ddm: 0.25, pe: 0.15, 'ev-ebitda': 0.25 },
    assumptions: {
      wacc: 0.075,
      terminalGrowth: 0.018,
      costOfEquity: 0.085,
      relativeMultiples: {
        'ev-ebitda': { conservative: 7, base: 9, optimistic: 11 },
        pe: { conservative: 14, base: 17, optimistic: 20 },
      },
    },
  },
  {
    ruleId: 'energy-v1',
    sectors: ['energy', 'basic materials'],
    preferredModels: ['ev-ebitda', 'ev-sales', 'pb', 'fcff-dcf'],
    modelWeights: { 'ev-ebitda': 0.3, 'ev-sales': 0.25, pb: 0.25, 'fcff-dcf': 0.2 },
    assumptions: {
      wacc: 0.1,
      terminalGrowth: 0.015,
      costOfEquity: 0.11,
      relativeMultiples: {
        'ev-sales': { conservative: 0.6, base: 1, optimistic: 1.4 },
        'ev-ebitda': { conservative: 4, base: 6, optimistic: 8 },
        pb: { conservative: 0.8, base: 1.1, optimistic: 1.4 },
      },
    },
  },
  {
    ruleId: 'healthcare-v1',
    sectors: ['healthcare'],
    preferredModels: ['pe', 'ev-sales', 'fcff-dcf'],
    modelWeights: { pe: 0.3, 'ev-sales': 0.4, 'fcff-dcf': 0.3 },
    assumptions: {
      wacc: 0.095,
      terminalGrowth: 0.02,
      costOfEquity: 0.105,
      relativeMultiples: {
        'ev-sales': { conservative: 1.5, base: 2.5, optimistic: 3.5 },
        pe: { conservative: 16, base: 22, optimistic: 28 },
      },
    },
  },
  {
    ruleId: 'generic-v1',
    sectors: [],
    preferredModels: ['fcff-dcf', 'ev-ebitda', 'ev-sales', 'pe', 'pb', 'ddm'],
    modelWeights: { 'fcff-dcf': 0.25, 'ev-ebitda': 0.2, 'ev-sales': 0.2, pe: 0.15, pb: 0.1, ddm: 0.1 },
    assumptions: {
      wacc: 0.1,
      terminalGrowth: 0.02,
      costOfEquity: 0.11,
      relativeMultiples: {
        'ev-sales': { conservative: 0.8, base: 1.3, optimistic: 1.8 },
        'ev-ebitda': { conservative: 5, base: 7, optimistic: 9 },
        pe: { conservative: 12, base: 16, optimistic: 20 },
        pb: { conservative: 0.8, base: 1.1, optimistic: 1.4 },
      },
    },
  },
] as const;

export function normalizeClassification(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function selectSectorValuationRule(sector: string, industry: string): SectorValuationRule {
  const normalizedSector = normalizeClassification(sector);
  const normalizedIndustry = normalizeClassification(industry);
  const industryOverride = SECTOR_VALUATION_RULES.find((rule) =>
    rule.industryKeywords?.some((keyword) => normalizedIndustry.includes(normalizeClassification(keyword))),
  );
  if (industryOverride) return industryOverride;
  return SECTOR_VALUATION_RULES.find((rule) => rule.sectors.includes(normalizedSector))
    ?? SECTOR_VALUATION_RULES.at(-1)!;
}
