import type { DataFreshness } from '@/src/lib/market-data/types';

export const SCENARIOS = ['conservative', 'base', 'optimistic'] as const;
export const EVALUATION_YEARS = [1, 3, 5] as const;

export type ScenarioKey = (typeof SCENARIOS)[number];
export type EvaluationYears = (typeof EVALUATION_YEARS)[number];
export type EpsMode = 'ttm' | 'forward' | 'manual';
export type DisplayCurrency = 'USD' | 'THB';

export interface ScenarioAssumption {
  growthPercent: number | null;
  targetPe: number | null;
}

export interface PriceTargetInput {
  symbol: string | null;
  currentPriceUsd: number | null;
  stockCurrency: string | null;
  quoteFreshness: DataFreshness['status'] | null;
  years: number;
  epsMode: EpsMode;
  eps: number | null;
  marginOfSafetyPercent: number | null;
  forwardGrowthConfirmed: boolean;
  scenarios: Record<ScenarioKey, ScenarioAssumption>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ScenarioResult {
  futureEps: number;
  targetPriceUsd: number;
  mosPriceUsd: number;
  differenceUsd: number;
  differencePercent: number;
  direction: 'upside' | 'downside' | 'neutral';
}

export interface PriceTargetResult {
  years: EvaluationYears;
  eps: number;
  epsMode: EpsMode;
  marginOfSafetyPercent: number;
  scenarios: Record<ScenarioKey, ScenarioResult>;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function validYears(value: number): value is EvaluationYears {
  return EVALUATION_YEARS.includes(value as EvaluationYears);
}

function scenarioName(key: ScenarioKey): string {
  if (key === 'conservative') return 'Conservative';
  if (key === 'optimistic') return 'Optimistic';
  return 'Base';
}

export function parseFiniteDraft(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? normalizeZero(parsed) : null;
}

export function validatePriceTarget(input: PriceTargetInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.symbol) errors.push('กรุณาเลือกหุ้นจากผลการค้นหาก่อนคำนวณ');
  if (input.stockCurrency !== 'USD') {
    errors.push(input.stockCurrency
      ? `หุ้นนี้ใช้สกุลเงิน ${input.stockCurrency}; เครื่องมือนี้คำนวณจาก USD เป็น source of truth เท่านั้น`
      : 'ไม่มีข้อมูลสกุลเงินของหุ้นที่ตรวจสอบได้');
  }
  if (!finite(input.currentPriceUsd) || input.currentPriceUsd <= 0) {
    errors.push('ไม่มีราคาปัจจุบัน USD ที่ใช้งานได้');
  }
  if (input.quoteFreshness === 'stale' || input.quoteFreshness === 'unavailable' || input.quoteFreshness === 'unknown' || input.quoteFreshness === null) {
    errors.push('ราคาปัจจุบัน stale หรือไม่มีสถานะความสดที่ตรวจสอบได้ กรุณาเลือกหุ้นใหม่หรือลองอีกครั้ง');
  } else if (input.quoteFreshness === 'delayed' || input.quoteFreshness === 'end-of-day' || input.quoteFreshness === 'cached') {
    warnings.push(`ราคาปัจจุบันมีสถานะ ${input.quoteFreshness} ไม่ใช่ราคาสดแบบ realtime`);
  }

  if (!validYears(input.years)) errors.push('ระยะเวลาประเมินต้องเป็น 1, 3 หรือ 5 ปี');
  if (!finite(input.eps)) {
    errors.push('กรุณาระบุ EPS เป็นตัวเลขที่ตรวจสอบได้');
  } else if (input.eps <= 0) {
    errors.push('EPS น้อยกว่าหรือเท่ากับ 0 ทำให้วิธี P/E ไม่เหมาะสม ลองพิจารณา DCF, P/S หรือ EV/Sales');
  } else if (Math.abs(input.eps) > 1_000_000) {
    errors.push('EPS อยู่นอกช่วงที่เครื่องมือรองรับ');
  }

  if (!finite(input.marginOfSafetyPercent)) {
    errors.push('กรุณาระบุ Margin of Safety');
  } else if (input.marginOfSafetyPercent < 0 || input.marginOfSafetyPercent > 95) {
    errors.push('Margin of Safety ต้องอยู่ระหว่าง 0% ถึง 95%');
  }

  let forwardHasGrowth = false;
  for (const key of SCENARIOS) {
    const assumption = input.scenarios[key];
    const label = scenarioName(key);
    if (!finite(assumption.growthPercent)) {
      errors.push(`กรุณาระบุ Growth ของ ${label}`);
    } else {
      if (assumption.growthPercent <= -100 || assumption.growthPercent > 500) {
        errors.push(`Growth ของ ${label} ต้องมากกว่า -100% และไม่เกิน 500%`);
      }
      if (assumption.growthPercent > 30) {
        warnings.push(`Growth ของ ${label} สูงกว่า 30% ต่อปี ควรตรวจสอบสมมติฐาน`);
      }
      if (assumption.growthPercent !== 0) forwardHasGrowth = true;
    }

    if (!finite(assumption.targetPe)) {
      errors.push(`กรุณาระบุ Target P/E ของ ${label}`);
    } else {
      if (assumption.targetPe <= 0 || assumption.targetPe > 500) {
        errors.push(`Target P/E ของ ${label} ต้องมากกว่า 0 และไม่เกิน 500`);
      }
      if (assumption.targetPe > 50) {
        warnings.push(`Target P/E ของ ${label} สูงกว่า 50 เท่า ควรตรวจสอบสมมติฐาน`);
      }
    }
  }

  if (input.epsMode === 'forward' && forwardHasGrowth && !input.forwardGrowthConfirmed) {
    errors.push('Forward EPS อาจรวมการเติบโตไว้แล้ว โปรดยืนยันก่อนทบ Growth ต่อเพื่อป้องกันการนับซ้ำ');
  }

  return { valid: errors.length === 0, errors, warnings };
}

function calculateScenario(
  eps: number,
  years: EvaluationYears,
  currentPriceUsd: number,
  marginOfSafetyPercent: number,
  assumption: { growthPercent: number; targetPe: number },
): ScenarioResult {
  // Percentage inputs are converted to decimal exactly once at the formula boundary.
  const growthDecimal = assumption.growthPercent / 100;
  const marginDecimal = marginOfSafetyPercent / 100;
  const futureEps = eps * Math.pow(1 + growthDecimal, years);
  const targetPriceUsd = futureEps * assumption.targetPe;
  const mosPriceUsd = targetPriceUsd * (1 - marginDecimal);
  const differenceUsd = targetPriceUsd - currentPriceUsd;
  const differencePercent = differenceUsd / currentPriceUsd * 100;
  const values = [futureEps, targetPriceUsd, mosPriceUsd, differenceUsd, differencePercent];
  if (values.some((value) => !Number.isFinite(value))) throw new Error('ผลคำนวณไม่เป็นจำนวน finite');

  const normalizedPercent = normalizeZero(differencePercent);
  const direction = Math.abs(normalizedPercent) < 0.1
    ? 'neutral'
    : normalizedPercent > 0
      ? 'upside'
      : 'downside';
  return {
    futureEps: normalizeZero(futureEps),
    targetPriceUsd: normalizeZero(targetPriceUsd),
    mosPriceUsd: normalizeZero(mosPriceUsd),
    differenceUsd: normalizeZero(differenceUsd),
    differencePercent: normalizedPercent,
    direction,
  };
}

export function calculatePriceTarget(input: PriceTargetInput): PriceTargetResult {
  const eps = input.eps;
  const currentPriceUsd = input.currentPriceUsd;
  const marginOfSafetyPercent = input.marginOfSafetyPercent;
  const evaluationYears = input.years;
  const validation = validatePriceTarget(input);
  if (!validation.valid || !validYears(evaluationYears) || !finite(eps)
    || !finite(currentPriceUsd) || !finite(marginOfSafetyPercent)) {
    throw new Error(validation.errors[0] ?? 'ข้อมูลไม่พร้อมคำนวณ');
  }

  const scenarios = Object.fromEntries(SCENARIOS.map((key) => {
    const assumption = input.scenarios[key];
    if (!finite(assumption.growthPercent) || !finite(assumption.targetPe)) {
      throw new Error(`สมมติฐาน ${scenarioName(key)} ไม่ครบ`);
    }
    return [key, calculateScenario(
      eps,
      evaluationYears,
      currentPriceUsd,
      marginOfSafetyPercent,
      { growthPercent: assumption.growthPercent, targetPe: assumption.targetPe },
    )];
  })) as Record<ScenarioKey, ScenarioResult>;

  return {
    years: evaluationYears,
    eps,
    epsMode: input.epsMode,
    marginOfSafetyPercent,
    scenarios,
  };
}

export function convertUsdForDisplay(
  valueUsd: number,
  currency: DisplayCurrency,
  usdThbRate: number | null,
): number | null {
  if (!Number.isFinite(valueUsd)) return null;
  if (currency === 'USD') return normalizeZero(valueUsd);
  if (!finite(usdThbRate) || usdThbRate <= 0) return null;
  const converted = valueUsd * usdThbRate;
  return Number.isFinite(converted) ? normalizeZero(converted) : null;
}

export function formatDisplayMoney(
  valueUsd: number,
  currency: DisplayCurrency,
  usdThbRate: number | null,
  signed = false,
): string {
  const converted = convertUsdForDisplay(valueUsd, currency, usdThbRate);
  if (converted === null) return 'unavailable';
  const sign = converted < 0 ? '-' : signed && converted > 0 ? '+' : '';
  const formatted = Math.abs(converted).toLocaleString(currency === 'USD' ? 'en-US' : 'th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${currency === 'USD' ? '$' : '฿'}${formatted}`;
}

export function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) return 'unavailable';
  const normalized = normalizeZero(value);
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(2)}%`;
}
