import type { FinancialPeriod } from './types';

/**
 * Company lifecycle stage, decided from *real fundamentals* — profitability, cash
 * flow, dividend history and the revenue trend — never from the sector/industry
 * label. Sector/industry is at most a weak hint (only the financial-institution
 * case, whose whole valuation framework differs).
 *
 * This is the fix for "every Aerospace & Defense name is high-growth from one
 * keyword": a mature, cash-generative prime (LMT/NOC/GD) is classified
 * `mature-profitable` from its own statements and is NOT routed into a growth
 * multiple, while a pre-profit growth name (RKLB) is `pre-profit-high-growth`.
 * No value is invented and no default stage is assumed when the data is missing —
 * that case is reported as `insufficient-data`.
 */
export type CompanyStage =
  | 'pre-profit-high-growth'
  | 'profitable-growth'
  | 'mature-profitable'
  | 'financial'
  | 'insufficient-data';

export interface CompanyStageSignals {
  netIncome: number | null;
  ebitda: number | null;
  freeCashFlow: number | null;
  dilutedEps: number | null;
  dividendPeriods: number;
  revenueCagr: number | null;
  sustainedProfitability: boolean;
}

export interface CompanyStageAssessment {
  stage: CompanyStage;
  reason: string;
  /**
   * True only when the fundamentals themselves justify a growth / pre-profit
   * relative multiple. The high-growth *industry* rule is applied only when this
   * is true, so a mature prime is never routed into the growth multiple purely
   * because its industry keyword matches.
   */
  supportsGrowthMultiple: boolean;
  signals: CompanyStageSignals;
}

/** Revenue CAGR at/under which a profitable, non-dividend name reads as mature rather than growth. */
const MATURE_REVENUE_CAGR_CEILING = 0.1;

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Weak sector/industry hint used only to route genuine financial institutions. */
function isFinancialHint(sector: string, industry: string): boolean {
  return /\b(bank|banks|insurance|insurer|reinsurance|financial|capital markets|asset management|brokerage)\b/.test(
    `${sector} ${industry}`.toLowerCase(),
  );
}

/**
 * EBITDA from the provider when present, otherwise the standard operating-income +
 * D&A derivation from real provider lines. Never a fabricated or default value.
 */
function deriveEbitda(latest: FinancialPeriod): number | null {
  if (finite(latest.ebitda)) return latest.ebitda;
  if (finite(latest.operatingIncome) && finite(latest.depreciationAmortization)) {
    return latest.operatingIncome + latest.depreciationAmortization;
  }
  return null;
}

export function classifyCompanyStage(
  sector: string,
  industry: string,
  periods: readonly FinancialPeriod[],
): CompanyStageAssessment {
  const emptySignals: CompanyStageSignals = {
    netIncome: null, ebitda: null, freeCashFlow: null, dilutedEps: null,
    dividendPeriods: 0, revenueCagr: null, sustainedProfitability: false,
  };
  const latest = periods.at(-1);
  if (!latest) {
    return {
      stage: 'insufficient-data',
      reason: 'Insufficient-data: ไม่มีงบการเงินสำหรับจัดประเภทระยะของบริษัท จึงไม่เดา stage',
      supportsGrowthMultiple: false,
      signals: emptySignals,
    };
  }

  const netIncome = finite(latest.netIncome) ? latest.netIncome : null;
  const freeCashFlow = finite(latest.freeCashFlow) ? latest.freeCashFlow : null;
  const ebitda = deriveEbitda(latest);
  const dilutedEps = finite(latest.dilutedEps) ? latest.dilutedEps : null;
  const dividendPeriods = periods.filter((period) => finite(period.dividendsPaid) && period.dividendsPaid < 0).length;
  const earliest = periods.at(0)!;
  const years = Math.max(1, periods.length - 1);
  const revenueCagr = earliest.revenue > 0 && latest.revenue > 0
    ? (latest.revenue / earliest.revenue) ** (1 / years) - 1
    : null;
  const sustainedProfitability = periods.length >= 2 && periods.every((period) => finite(period.netIncome) && period.netIncome > 0);
  const signals: CompanyStageSignals = { netIncome, ebitda, freeCashFlow, dilutedEps, dividendPeriods, revenueCagr, sustainedProfitability };

  // Core profitability data must exist; without net income and free cash flow we do
  // not guess a stage — the requirement is an explicit insufficient-data outcome.
  if (netIncome === null || freeCashFlow === null) {
    return {
      stage: 'insufficient-data',
      reason: 'Insufficient-data: ขาดกำไรสุทธิหรือกระแสเงินสดอิสระที่จำเป็นต่อการจัดประเภท',
      supportsGrowthMultiple: false,
      signals,
    };
  }

  // Financial institutions use a different framework (P/B, DDM). This weak sector
  // hint never routes into an operating-company growth multiple.
  if (isFinancialHint(sector, industry)) {
    return {
      stage: 'financial',
      reason: 'Financial: sector/industry เป็นสถาบันการเงิน จึงใช้กรอบประเมินเฉพาะ ไม่ใช้ growth multiple ของบริษัทดำเนินงาน',
      supportsGrowthMultiple: false,
      signals,
    };
  }

  const ebitdaNonPositive = ebitda === null || ebitda <= 0;
  const epsNonPositive = dilutedEps === null || dilutedEps <= 0;
  const highRevenueGrowth = revenueCagr !== null && revenueCagr > MATURE_REVENUE_CAGR_CEILING;

  // Pre-profit / high-growth: net income, EBITDA and free cash flow are all
  // non-positive and there is no dividend history. This is the RKLB shape.
  if (netIncome <= 0 && freeCashFlow <= 0 && ebitdaNonPositive && epsNonPositive && dividendPeriods === 0) {
    const negativeLines = [
      'กำไรสุทธิ',
      ...(ebitda !== null ? ['EBITDA'] : []),
      'FCF',
      ...(dilutedEps !== null ? ['EPS'] : []),
    ];
    return {
      stage: 'pre-profit-high-growth',
      reason: `Pre-profit: ${negativeLines.join(', ')} เป็นลบ และไม่มีประวัติเงินปันผล`,
      supportsGrowthMultiple: true,
      signals,
    };
  }

  // Mature-profitable: sustained positive earnings and free cash flow, backed by a
  // multi-period dividend history and/or a non-high-growth revenue trend. This is
  // the LMT/NOC/GD prime shape — never routed into the growth multiple, even though
  // its industry keyword is "Aerospace & Defense".
  if (netIncome > 0 && freeCashFlow > 0 && sustainedProfitability && (dividendPeriods >= 2 || !highRevenueGrowth)) {
    const dividendNote = dividendPeriods >= 2 ? ' พร้อมประวัติการจ่ายเงินปันผลหลายงวด' : '';
    return {
      stage: 'mature-profitable',
      reason: `Mature profitable: earnings และ FCF เป็นบวกต่อเนื่อง${dividendNote}`,
      supportsGrowthMultiple: false,
      signals,
    };
  }

  // Profitable-growth: at least one profitability line is positive alongside a
  // growing top line, but the mature (dividend / sustained) test is not met.
  if ((netIncome > 0 || freeCashFlow > 0) && revenueCagr !== null && revenueCagr > 0) {
    return {
      stage: 'profitable-growth',
      reason: 'Profitable growth: มีกำไร/กระแสเงินสดเป็นบวกและรายได้เติบโต แต่ยังไม่ครบเกณฑ์ mature (ปันผล/กำไรต่อเนื่อง)',
      supportsGrowthMultiple: true,
      signals,
    };
  }

  // Mixed but present data (e.g. positive earnings with negative FCF, or flat
  // revenue): classify by the dominant positive signal without guessing a mature
  // stage. A growth multiple is defensible for a non-mature operating company.
  if (netIncome > 0 || freeCashFlow > 0 || (ebitda !== null && ebitda > 0)) {
    return {
      stage: 'profitable-growth',
      reason: 'Profitable growth: มีสัญญาณกำไรเป็นบวกบางส่วนแต่ยังไม่คงที่พอจะจัดเป็น mature',
      supportsGrowthMultiple: true,
      signals,
    };
  }

  // Loss-making without a clean pre-profit signature (e.g. a loss-maker still paying
  // a dividend): treat as pre-profit for routing but say so honestly.
  return {
    stage: 'pre-profit-high-growth',
    reason: 'Pre-profit: กำไร กระแสเงินสด และ EBITDA ยังไม่เป็นบวก',
    supportsGrowthMultiple: true,
    signals,
  };
}
