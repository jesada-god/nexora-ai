import { percentile } from './monte-carlo';
import { blackScholes } from './pricing';
import type { MonteCarloSettings, OptionLeg, SimulationWorkspace } from './types';

const SCORE_WEIGHTS = {
  pop: 0.4,
  riskAdjustedEv: 0.3,
  median: 0.15,
  downside: 0.1,
  targetDirection: 0.05,
} as const;

type ScoreMetric = keyof typeof SCORE_WEIGHTS;

export interface CallPutScenarioMetrics {
  probabilityOfProfit: number;
  expectedProfitLoss: number;
  riskAdjustedEv: number;
  medianProfitLoss: number;
  p5ProfitLoss: number;
  expectedShortfall95ProfitLoss: number;
  maxLoss: number;
  downsideValue: number;
  initialRisk: number;
  targetDirectionConsistency: number;
}

export interface ScenarioScoreAssumptions {
  currentPrice: number;
  targetPrice: number;
  targetDate: string;
  expiration: string;
  volatility: number;
  rate: number;
  dividendYield: number;
  strikeDistance: number;
  quantity: number;
  multiplier: number;
  paths: number;
  seed: number;
  callPremium: number;
  putPremium: number;
}

export type CallPutScenarioScore =
  | {
    status: 'available';
    callPercent: number;
    putPercent: number;
    callScore: number;
    putScore: number;
    outlook: 'unclear' | 'leaning';
    reasons: string[];
    callMetrics: CallPutScenarioMetrics;
    putMetrics: CallPutScenarioMetrics;
    assumptions: ScenarioScoreAssumptions;
    auditStatus: 'passed';
  }
  | {
    status: 'unavailable';
    reason: string;
    auditStatus: 'not-run' | 'failed';
  };

interface ComparablePair {
  call: OptionLeg;
  put: OptionLeg;
  strikeDistance: number;
}

interface MetricPair {
  call: number;
  put: number;
}

interface WeightedMetric {
  key: ScoreMetric;
  callShare: number;
  putShare: number;
  contributionDifference: number;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} ไม่เป็น finite number`);
  return Object.is(value, -0) ? 0 : value;
}

function mean(values: number[]): number {
  if (values.length === 0) throw new Error('ไม่มี valid paths สำหรับคำนวณคะแนน');
  return finite(values.reduce((sum, value) => sum + value, 0) / values.length, 'ค่าเฉลี่ย');
}

function calendarDaysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  if (![fromYear, fromMonth, fromDay, toYear, toMonth, toDay].every(Number.isFinite)) return Number.NaN;
  return (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000;
}

function actualPremiumAvailable(leg: OptionLeg): boolean {
  return leg.side === 'buy'
    && Number.isFinite(leg.entryPremium)
    && leg.entryPremium > 0
    && Number.isFinite(leg.fees)
    && leg.fees >= 0;
}

function sameNumber(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-10;
}

function resolveComparablePair(workspace: SimulationWorkspace, targetDate: string): ComparablePair | string {
  const spot = workspace.underlyingPrice;
  if (spot === null || !Number.isFinite(spot) || spot <= 0) return 'ไม่มี Current Price ที่ใช้เปรียบเทียบได้';

  const calls = workspace.legs.filter((leg) => leg.kind === 'call' && actualPremiumAvailable(leg));
  const puts = workspace.legs.filter((leg) => leg.kind === 'put' && actualPremiumAvailable(leg));
  if (calls.length === 0 || puts.length === 0) {
    return 'ต้องมี Long Call และ Long Put ที่ระบุ Premium จริงมากกว่า 0 ทั้งสองฝั่ง';
  }

  const tolerance = Math.max(0.01, spot * 1e-6);
  const pairs = calls.flatMap((call) => puts.flatMap((put) => {
    const callDistance = call.strike - spot;
    const putDistance = spot - put.strike;
    const comparable = callDistance >= -tolerance
      && putDistance >= -tolerance
      && Math.abs(callDistance - putDistance) <= tolerance
      && call.expiration === put.expiration
      && targetDate <= call.expiration
      && sameNumber(call.quantity, put.quantity)
      && sameNumber(call.multiplier, put.multiplier);
    return comparable ? [{ call, put, strikeDistance: Math.max(0, (callDistance + putDistance) / 2) }] : [];
  }));

  if (pairs.length === 0) {
    return 'ไม่พบ Long Call/Long Put ที่มีวันหมดอายุ ระยะ Strike, Quantity และ Multiplier เท่ากัน';
  }
  return pairs.sort((left, right) => (
    left.strikeDistance - right.strikeDistance
    || left.call.id.localeCompare(right.call.id)
    || left.put.id.localeCompare(right.put.id)
  ))[0];
}

function initialRisk(leg: OptionLeg): number {
  return finite(leg.entryPremium * leg.quantity * leg.multiplier + leg.fees, `${leg.kind} initial risk`);
}

function pathProfitLoss(
  terminalPrice: number,
  leg: OptionLeg,
  targetDate: string,
  settings: MonteCarloSettings,
): number {
  const timeYears = Math.max(0, calendarDaysBetween(targetDate, leg.expiration)) / 365;
  const optionValue = blackScholes({
    spot: terminalPrice,
    strike: leg.strike,
    timeYears,
    volatility: settings.volatility,
    rate: settings.rate,
    dividendYield: settings.dividendYield,
    kind: leg.kind,
  }).value;
  return finite(
    optionValue * leg.quantity * leg.multiplier - initialRisk(leg),
    `${leg.kind} path P&L`,
  );
}

function metricsFor(
  leg: OptionLeg,
  terminalPrices: number[],
  targetDate: string,
  settings: MonteCarloSettings,
  targetDirectionConsistency: number,
): CallPutScenarioMetrics {
  const profits = terminalPrices
    .map((terminalPrice) => pathProfitLoss(terminalPrice, leg, targetDate, settings))
    .sort((left, right) => left - right);
  const risk = initialRisk(leg);
  if (!(risk > 0)) throw new Error(`${leg.kind} initial risk ต้องมากกว่า 0`);
  const p5 = percentile(profits, 0.05);
  const lowerTail = profits.filter((value) => value <= p5);
  const expectedShortfall = mean(lowerTail);
  const maxLoss = -risk;
  // The contract asks for the less-bad value among P5, ES and Max Loss.
  const downsideValue = Math.max(p5, expectedShortfall, maxLoss);
  const expectedProfitLoss = mean(profits);
  return {
    probabilityOfProfit: profits.filter((value) => value > 0).length / profits.length,
    expectedProfitLoss,
    riskAdjustedEv: finite(expectedProfitLoss / risk, `${leg.kind} risk-adjusted EV`),
    medianProfitLoss: finite(percentile(profits, 0.5), `${leg.kind} median`),
    p5ProfitLoss: finite(p5, `${leg.kind} P5`),
    expectedShortfall95ProfitLoss: finite(expectedShortfall, `${leg.kind} ES95`),
    maxLoss,
    downsideValue: finite(downsideValue / risk, `${leg.kind} downside score input`),
    initialRisk: risk,
    targetDirectionConsistency,
  };
}

export function normalizeScenarioMetricPair(call: number, put: number): MetricPair {
  if (!Number.isFinite(call) || !Number.isFinite(put)) throw new Error('Score metric ต้องเป็น finite number');
  const denominator = Math.abs(call) + Math.abs(put);
  if (denominator <= Number.EPSILON) return { call: 0.5, put: 0.5 };
  const callShare = Math.min(1, Math.max(0, (1 + (call - put) / denominator) / 2));
  return { call: finite(callShare, 'normalized Call metric'), put: finite(1 - callShare, 'normalized Put metric') };
}

function metricPairs(call: CallPutScenarioMetrics, put: CallPutScenarioMetrics): Record<ScoreMetric, MetricPair> {
  return {
    pop: { call: call.probabilityOfProfit, put: put.probabilityOfProfit },
    riskAdjustedEv: { call: call.riskAdjustedEv, put: put.riskAdjustedEv },
    median: { call: call.medianProfitLoss / call.initialRisk, put: put.medianProfitLoss / put.initialRisk },
    downside: { call: call.downsideValue, put: put.downsideValue },
    targetDirection: { call: call.targetDirectionConsistency, put: put.targetDirectionConsistency },
  };
}

function reasonFor(metric: WeightedMetric, raw: MetricPair): string {
  const callBetter = raw.call > raw.put;
  const putBetter = raw.put > raw.call;
  if (!callBetter && !putBetter) {
    const tied: Record<ScoreMetric, string> = {
      pop: 'POP ของ Call และ Put เท่ากัน',
      riskAdjustedEv: 'Expected P&L ต่อเงินเสี่ยงของ Call และ Put เท่ากัน',
      median: 'Median P&L ต่อเงินเสี่ยงของ Call และ Put เท่ากัน',
      downside: 'downside จาก P5/ES/Max Loss ของ Call และ Put เท่ากัน',
      targetDirection: 'Call และ Put สอดคล้องกับทิศทาง Target เท่ากัน',
    };
    return tied[metric.key];
  }
  const better = callBetter ? 'Call' : 'Put';
  const worse = callBetter ? 'Put' : 'Call';
  const messages: Record<ScoreMetric, string> = {
    pop: `${better} มี POP สูงกว่า ${worse}`,
    riskAdjustedEv: `${better} มี Expected P&L ต่อเงินเสี่ยงดีกว่า ${worse}`,
    median: `${better} มี Median P&L ต่อเงินเสี่ยงดีกว่า ${worse}`,
    downside: `downside ของ ${better} แย่น้อยกว่า ${worse}`,
    targetDirection: `${better} สอดคล้องกับทิศทาง Target มากกว่า ${worse}`,
  };
  return messages[metric.key];
}

export function scoreScenarioMetrics(
  call: CallPutScenarioMetrics,
  put: CallPutScenarioMetrics,
): Pick<Extract<CallPutScenarioScore, { status: 'available' }>, 'callPercent' | 'putPercent' | 'callScore' | 'putScore' | 'reasons'> {
  const rawPairs = metricPairs(call, put);
  const weighted = (Object.keys(SCORE_WEIGHTS) as ScoreMetric[]).map((key) => {
    const normalized = normalizeScenarioMetricPair(rawPairs[key].call, rawPairs[key].put);
    return {
      key,
      callShare: normalized.call,
      putShare: normalized.put,
      contributionDifference: SCORE_WEIGHTS[key] * (normalized.call - normalized.put),
    };
  });
  const callScore = finite(weighted.reduce((sum, metric) => sum + SCORE_WEIGHTS[metric.key] * metric.callShare, 0), 'Call score');
  const putScore = finite(weighted.reduce((sum, metric) => sum + SCORE_WEIGHTS[metric.key] * metric.putShare, 0), 'Put score');
  const total = callScore + putScore;
  if (!(total > 0) || !Number.isFinite(total)) throw new Error('ผลรวมคะแนนไม่ถูกต้อง');
  const callPercent = finite(Math.min(100, Math.max(0, callScore / total * 100)), 'Call percent');
  const putPercent = finite(100 - callPercent, 'Put percent');
  const reasons = weighted
    .sort((left, right) => Math.abs(right.contributionDifference) - Math.abs(left.contributionDifference))
    .slice(0, 3)
    .map((metric) => reasonFor(metric, rawPairs[metric.key]));
  return { callPercent, putPercent, callScore, putScore, reasons };
}

export function calculateCallPutScenarioScore(
  workspace: SimulationWorkspace,
  settings: MonteCarloSettings,
  terminalPrices: number[],
  targetPrice: number,
): CallPutScenarioScore {
  const targetDate = workspace.scenarios[0]?.valuationDate;
  const pair = targetDate ? resolveComparablePair(workspace, targetDate) : 'ไม่มี Target Date สำหรับเปรียบเทียบ';
  if (typeof pair === 'string') return { status: 'unavailable', reason: pair, auditStatus: 'not-run' };
  try {
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) throw new Error('Target Price ไม่ถูกต้อง');
    if (!Number.isFinite(settings.volatility) || settings.volatility <= 0) throw new Error('IV ต้องมากกว่า 0');
    if (terminalPrices.length !== settings.paths) {
      throw new Error(`valid paths ${terminalPrices.length.toLocaleString()} ไม่เท่ากับ paths ${settings.paths.toLocaleString()}`);
    }
    if (!terminalPrices.every((value) => Number.isFinite(value) && value > 0)) throw new Error('terminal prices มีค่าที่ไม่ถูกต้อง');
    const spot = workspace.underlyingPrice as number;
    const targetDirection = targetPrice > spot ? { call: 1, put: 0 } : targetPrice < spot ? { call: 0, put: 1 } : { call: 0.5, put: 0.5 };
    const callMetrics = metricsFor(pair.call, terminalPrices, targetDate, settings, targetDirection.call);
    const putMetrics = metricsFor(pair.put, terminalPrices, targetDate, settings, targetDirection.put);
    const score = scoreScenarioMetrics(callMetrics, putMetrics);
    const auditPassed = score.callPercent >= 0
      && score.callPercent <= 100
      && score.putPercent >= 0
      && score.putPercent <= 100
      && Math.abs(score.callPercent + score.putPercent - 100) <= 1e-10
      && [score.callScore, score.putScore, ...Object.values(callMetrics), ...Object.values(putMetrics)].every(Number.isFinite);
    if (!auditPassed) throw new Error('คะแนนไม่ผ่าน bounded/finite/sum audit');
    return {
      status: 'available',
      ...score,
      outlook: Math.abs(score.callPercent - score.putPercent) < 10 ? 'unclear' : 'leaning',
      callMetrics,
      putMetrics,
      assumptions: {
        currentPrice: spot,
        targetPrice,
        targetDate,
        expiration: pair.call.expiration,
        volatility: settings.volatility,
        rate: settings.rate,
        dividendYield: settings.dividendYield,
        strikeDistance: pair.strikeDistance,
        quantity: pair.call.quantity,
        multiplier: pair.call.multiplier,
        paths: settings.paths,
        seed: settings.seed,
        callPremium: pair.call.entryPremium,
        putPremium: pair.put.entryPremium,
      },
      auditStatus: 'passed',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `audit ไม่ผ่าน: ${error instanceof Error ? error.message : 'ไม่สามารถตรวจสอบคะแนนได้'}`,
      auditStatus: 'failed',
    };
  }
}
